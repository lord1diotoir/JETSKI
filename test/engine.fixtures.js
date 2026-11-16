// Shared inline fixtures for engine tests (real property values, synthetic square geometry).
export function square(lon, lat, size = 0.01) {
  return {
    type: 'Polygon',
    coordinates: [[[lon, lat], [lon + size, lat], [lon + size, lat + size], [lon, lat + size], [lon, lat]]],
  };
}
export const feat = (props, geometry) => ({ type: 'Feature', properties: props, geometry });

export const browardSS25 = feat({
  OBJECTID: 50, CLASS1_68C: 'SS', DATE1_68C: 'NOV 15 - MAR 31', CLASS2_68C: '25 MPH', DATE2_68C: 'APR 1 - NOV 14',
  SECT_68C: '68C-22.010(2)(e)', TEXT_68C: 'Slow Speed (Nov15 -Mar31) Max 25 MPH (Apr1-Nov14)', NOTES_68C: ' ',
  COUNTY: 'BROWARD', _layer: 'manatee', _id: 'fwc68c-50',
}, square(-80.12, 26.10));

export const mdSS30 = feat({
  OBJECTID: 70, CLASS1_68C: 'SS', DATE1_68C: 'NOV 15 - APR 30', CLASS2_68C: '30 MPH', DATE2_68C: 'MAY 1 - NOV 14',
  SECT_68C: '68C-22.025(1)(b)1.', TEXT_68C: 'Slow Speed (Nov 15 - Apr 30), 30 MPH (Remainder of Year)', NOTES_68C: 'Test waters',
  COUNTY: 'MIAMI-DADE', _layer: 'manatee', _id: 'fwc68c-70',
}, square(-80.20, 25.80));

export const ssWknd = feat({
  OBJECTID: 51, CLASS1_68C: 'SS WKND', DATE1_68C: 'NOV 15 - MAR 31', CLASS2_68C: '25 MPH', DATE2_68C: 'APR 1 - NOV 14',
  SECT_68C: '68C-22.010(2)(g)',
  TEXT_68C: 'Slow(Nov15 -Mar31 7am-7pm wknds&Holidays) 25MPH(Apr1-Nov14)(Nov15-Mar31wkdays&wknds/holiday 7pm-7am)',
  NOTES_68C: ' ', COUNTY: 'BROWARD', _layer: 'manatee', _id: 'fwc68c-51',
}, square(-80.11, 26.12));

export const sunriseSouth = feat({
  OBJECTID: 54, AREA_NUM: '68D-24.008(1)(a)7.b.', AREA_NAME: 'Sunrise Boulevard Bridge - South',
  RESTRICTION: 'Slow Speed Minimum Wake - Conditional', CON_SHORT: 'Saturdays, Sundays and Holidays',
  HYPERLINK: 'https://www.flrules.org/gateway/RuleNo.asp?title=BOATING%20RESTRICTED%20AREAS&ID=68D-24.008',
  NOTES: ' ', DATE_IMP: '2013-07-13', _layer: 'bra', _id: 'fwc68d-54', _status: 'gis',
}, square(-80.105, 26.135));

// Countywide 30 MPH zone: big square containing the idle zone below.
export const county30 = feat({
  OBJECTID: 144, AREA_NUM: '68D-24.008(1)(b)', AREA_NAME: 'Broward County 30 MPH / 15 inch wake / 80 dBA sound zone',
  RESTRICTION: 'Max Speed 30 MPH / Max Wake 15 Inches / Max Sound 80 dBA', CON_SHORT: 'Except where superseded by other law.',
  HYPERLINK: 'https://www.flrules.org/gateway/RuleNo.asp?title=BOATING%20RESTRICTED%20AREAS&ID=68D-24.008',
  NOTES: ' ', _layer: 'bra', _id: 'fwc68d-144', _status: 'gis',
}, square(-80.20, 26.00, 0.2));

export const idleBridge = feat({
  OBJECTID: 56, AREA_NUM: '68D-24.008(1)(a)10.', AREA_NAME: '17th Causeway Bridge', RESTRICTION: 'Idle Speed No Wake',
  CON_SHORT: 'At All Times', HYPERLINK: 'https://www.flrules.org/gateway/RuleNo.asp?title=BOATING%20RESTRICTED%20AREAS&ID=68D-24.008',
  NOTES: ' ', _layer: 'bra', _id: 'fwc68d-56', _status: 'gis',
}, square(-80.15, 26.05, 0.01));

export const unconfirmed = feat({
  OBJECTID: 152, AREA_NUM: '68D-24.008(1)(a)14.c.', AREA_NAME: 'Hallandale Beach Boulevard Slow Speed Minimum Wake',
  RESTRICTION: 'Slow Speed Minimum Wake', CON_SHORT: 'At All Times', NOTES: 'To be voted on by Commission 8/5/2021',
  DATE_IMP: null, HYPERLINK: 'https://www.flrules.org/gateway/RuleNo.asp?title=BOATING%20RESTRICTED%20AREAS&ID=68D-24.008',
  _layer: 'bra', _id: 'fwc68d-152', _status: 'unconfirmed',
}, square(-80.12, 25.98, 0.01));

export const unknownCode = feat({
  OBJECTID: 99, CLASS1_68C: 'XYZ', DATE1_68C: 'JAN 1 - DEC 31', CLASS2_68C: 'XYZ', DATE2_68C: 'JAN 1 - DEC 31',
  SECT_68C: '68C-22.010(9)', TEXT_68C: 'Mystery', NOTES_68C: ' ', COUNTY: 'BROWARD', _layer: 'manatee', _id: 'fwc68c-99',
}, square(-80.30, 26.30, 0.01));

export const digitizedUscg = feat({
  _layer: 'uscg', _id: 'uscg-760-midnorth', _status: 'digitized', name: 'Port Everglades Mid-Port to North-Port security zone',
  rule: '33 CFR 165.760(b)(3)', ruleUrl: 'https://www.ecfr.gov/current/title-33/section-165.760',
  restriction: 'No Entry Without COTP Permission', schedule: 'At All Times', notes: 'digitized', method: 'manual',
}, square(-80.13, 26.08, 0.005));
