import { generateHouseholdToken, generateId } from '../lib/token.js';

export const MAX_PROFILES_PER_HOUSEHOLD = 12;

// D1 repository for households + profiles.
//
// Every method is async: D1's query API is promise-based, unlike the
// synchronous better-sqlite3 API the Node build used. Statements are still
// always parameter-bound (never string-interpolated), which is the property
// design.md §6 actually cares about.
export class HouseholdsRepo {
  constructor(db) {
    this.db = db;
  }

  async createHousehold() {
    const id = generateHouseholdToken();
    await this.db
      .prepare('INSERT INTO households (id, created_at, active_profile_id) VALUES (?, ?, NULL)')
      .bind(id, Date.now())
      .run();
    return id;
  }

  async getHousehold(id) {
    return this.db.prepare('SELECT * FROM households WHERE id = ?').bind(id).first();
  }

  async listProfiles(householdId) {
    const { results } = await this.db
      .prepare(
        'SELECT * FROM profiles WHERE household_id = ? ORDER BY sort_order ASC, created_at ASC'
      )
      .bind(householdId)
      .all();
    return results ?? [];
  }

  async getProfile(householdId, profileId) {
    return this.db
      .prepare('SELECT * FROM profiles WHERE id = ? AND household_id = ?')
      .bind(profileId, householdId)
      .first();
  }

  async createProfile(householdId, { name, avatarUrl = null, pinHash = null, isKids = false }) {
    const household = await this.getHousehold(householdId);
    if (!household) {
      throw new HouseholdNotFoundError(householdId);
    }
    const countRow = await this.db
      .prepare('SELECT COUNT(*) AS n FROM profiles WHERE household_id = ?')
      .bind(householdId)
      .first();
    if ((countRow?.n ?? 0) >= MAX_PROFILES_PER_HOUSEHOLD) {
      throw new ProfileLimitError(householdId);
    }
    const nextRow = await this.db
      .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM profiles WHERE household_id = ?')
      .bind(householdId)
      .first();

    const id = generateId();
    await this.db
      .prepare(
        `INSERT INTO profiles (id, household_id, name, avatar_url, pin_hash, is_kids, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        householdId,
        name,
        avatarUrl,
        pinHash,
        isKids ? 1 : 0,
        nextRow?.next ?? 0,
        Date.now()
      )
      .run();
    return this.getProfile(householdId, id);
  }

  // Atomic switch: still a single UPDATE. Returns true if it changed anything.
  async setActiveProfile(householdId, profileId) {
    const result = await this.db
      .prepare(
        'UPDATE households SET active_profile_id = ? WHERE id = ? AND active_profile_id IS NOT ?'
      )
      .bind(profileId, householdId, profileId)
      .run();
    return (result.meta?.changes ?? 0) > 0;
  }

  async updateProfile(householdId, profileId, { name, avatarUrl, pinHash, isKids, sortOrder }) {
    const existing = await this.getProfile(householdId, profileId);
    if (!existing) {
      throw new ProfileNotFoundError(profileId);
    }
    await this.db
      .prepare(
        `UPDATE profiles SET name = ?, avatar_url = ?, pin_hash = ?, is_kids = ?, sort_order = ?
         WHERE id = ? AND household_id = ?`
      )
      .bind(
        name ?? existing.name,
        avatarUrl === undefined ? existing.avatar_url : avatarUrl,
        pinHash === undefined ? existing.pin_hash : pinHash,
        (isKids ?? Boolean(existing.is_kids)) ? 1 : 0,
        sortOrder ?? existing.sort_order,
        profileId,
        householdId
      )
      .run();
    return this.getProfile(householdId, profileId);
  }

  async deleteProfile(householdId, profileId) {
    const result = await this.db
      .prepare('DELETE FROM profiles WHERE id = ? AND household_id = ?')
      .bind(profileId, householdId)
      .run();
    if ((result.meta?.changes ?? 0) === 0) {
      throw new ProfileNotFoundError(profileId);
    }
    await this.db
      .prepare('UPDATE households SET active_profile_id = NULL WHERE id = ? AND active_profile_id = ?')
      .bind(householdId, profileId)
      .run();
  }

  // Applies a full ordering in one D1 batch. D1 has no interactive
  // transactions (no db.transaction(fn) like better-sqlite3), but batch() runs
  // its statements atomically in a single implicit transaction — same
  // all-or-nothing guarantee. Ids not belonging to the household are ignored
  // by the WHERE clause, exactly as before.
  async reorderProfiles(householdId, orderedProfileIds) {
    if (orderedProfileIds.length > 0) {
      const statement = this.db.prepare(
        'UPDATE profiles SET sort_order = ? WHERE id = ? AND household_id = ?'
      );
      await this.db.batch(
        orderedProfileIds.map((profileId, index) =>
          statement.bind(index, profileId, householdId)
        )
      );
    }
    return this.listProfiles(householdId);
  }
}

export class ProfileNotFoundError extends Error {
  constructor(profileId) {
    super(`profile not found: ${profileId}`);
    this.name = 'ProfileNotFoundError';
  }
}

export class HouseholdNotFoundError extends Error {
  constructor(householdId) {
    super(`household not found: ${householdId}`);
    this.name = 'HouseholdNotFoundError';
  }
}

export class ProfileLimitError extends Error {
  constructor(householdId) {
    super(`profile limit reached for household: ${householdId}`);
    this.name = 'ProfileLimitError';
  }
}
