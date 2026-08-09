import robotoRegular from '../../assets/fonts/Roboto-Regular.ttf';
import robotoBold from '../../assets/fonts/Roboto-Bold.ttf';

// Satori needs real font data — it converts text to vector outlines so that
// the SVG it emits is self-contained and resvg never has to resolve a system
// font. That's the property that makes this work on a runtime with no
// filesystem and no fontconfig at all, which the @napi-rs/canvas approach
// could never guarantee on a minimal container.
//
// These are the Google Fonts latin + latin-ext subsets of Roboto (Apache-2.0,
// see assets/fonts/LICENSE.txt) — ~47 KB each rather than the ~515 KB full
// family, which matters against the Free plan's 3 MB compressed bundle limit.
// Imported as ArrayBuffers via the [[rules]] type = "Data" entry in
// wrangler.toml.
export const FONTS = [
  { name: 'Roboto', data: robotoRegular, weight: 400, style: 'normal' },
  { name: 'Roboto', data: robotoBold, weight: 700, style: 'normal' },
];
