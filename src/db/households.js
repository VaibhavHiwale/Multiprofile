import { generateHouseholdToken, generateId } from '../lib/token.js';

export const MAX_PROFILES_PER_HOUSEHOLD = 12;

export class HouseholdsRepo {
  constructor(db) {
    this.db = db;
    this.stmts = {
      insertHousehold: db.prepare(
        'INSERT INTO households (id, created_at, active_profile_id) VALUES (?, ?, NULL)'
      ),
      getHousehold: db.prepare('SELECT * FROM households WHERE id = ?'),
      countProfiles: db.prepare(
        'SELECT COUNT(*) AS n FROM profiles WHERE household_id = ?'
      ),
      insertProfile: db.prepare(
        `INSERT INTO profiles (id, household_id, name, avatar_url, pin_hash, is_kids, sort_order, created_at)
         VALUES (@id, @householdId, @name, @avatarUrl, @pinHash, @isKids, @sortOrder, @createdAt)`
      ),
      setActiveProfile: db.prepare(
        'UPDATE households SET active_profile_id = ? WHERE id = ? AND active_profile_id IS NOT ?'
      ),
      getProfile: db.prepare('SELECT * FROM profiles WHERE id = ? AND household_id = ?'),
      listProfiles: db.prepare(
        'SELECT * FROM profiles WHERE household_id = ? ORDER BY sort_order ASC, created_at ASC'
      ),
      nextSortOrder: db.prepare(
        'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM profiles WHERE household_id = ?'
      ),
    };
  }

  createHousehold() {
    const id = generateHouseholdToken();
    this.stmts.insertHousehold.run(id, Date.now());
    return id;
  }

  getHousehold(id) {
    return this.stmts.getHousehold.get(id);
  }

  listProfiles(householdId) {
    return this.stmts.listProfiles.all(householdId);
  }

  getProfile(householdId, profileId) {
    return this.stmts.getProfile.get(profileId, householdId);
  }

  createProfile(householdId, { name, avatarUrl = null, pinHash = null, isKids = false }) {
    const household = this.getHousehold(householdId);
    if (!household) {
      throw new HouseholdNotFoundError(householdId);
    }
    const { n } = this.stmts.countProfiles.get(householdId);
    if (n >= MAX_PROFILES_PER_HOUSEHOLD) {
      throw new ProfileLimitError(householdId);
    }
    const { next } = this.stmts.nextSortOrder.get(householdId);
    const id = generateId();
    this.stmts.insertProfile.run({
      id,
      householdId,
      name,
      avatarUrl,
      pinHash,
      isKids: isKids ? 1 : 0,
      sortOrder: next,
      createdAt: Date.now(),
    });
    return this.getProfile(householdId, id);
  }

  // Atomic switch: single UPDATE, WAL-durable. Returns true if it changed anything.
  setActiveProfile(householdId, profileId) {
    const result = this.stmts.setActiveProfile.run(profileId, householdId, profileId);
    return result.changes > 0;
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
