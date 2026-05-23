/**
 * VERIFICATION QUERIES — Part Type Standardization
 *
 * DO NOT EXECUTE IN PRODUCTION WRITES.
 * Run read-only verification with: mongosh <connection-string> verify_migration.js
 *
 * Checks:
 *   1. Count of pieces per Part Type (expect only standardized names after migration)
 *   2. Any orphan pieces with unknown part types
 *   3. Bucket distribution
 *   4. Sample audit rows for manual inspection
 *   5. Total part/weight/sqft before vs. after consistency
 */

const db = db.getSiblingDB('stonedesk'); // adjust DB name if different

const STANDARDIZED_PART_TYPES = [
  'Kitchen - Island Tops',
  'Kitchen - Perimeter Tops',
  'Kitchen - Range Tops',
  'Kitchen - Back Splash',
  'Kitchen - Side Splash',
  'Vanity - Top',
  'Vanity - Back Splash',
  'Vanity - Side Splash',
  'Misc - Full Height Splash',
  'Misc - Window Sill',
  'Misc - Bar Top',
];

const OLD_PART_TYPES = [
  'Island Tops', 'Perimeter Kitchen Tops', 'Range Tops',
  'Kitchen Back Splash', 'Kitchen Side Splash',
  'Vanity Top', 'Vanity Back Splash', 'Vanity Side Splash',
  'Full Height Splash', 'Window Sill', 'Bar Top',
];

print('=== VERIFICATION: Part Type Standardization ===');
print('');

// ── 1. Count by Part Type ─────────────────────────────────────────────────────
print('--- 1. Piece count by Part Type ---');
const partTypeCounts = db.pieces.aggregate([
  { $group: { _id: '$part', count: { $sum: 1 } } },
  { $sort: { count: -1 } },
]).toArray();
partTypeCounts.forEach(r => print(`  "${r._id}": ${r.count}`));
print('');

// ── 2. Check for old names still present ─────────────────────────────────────
print('--- 2. Old Part Type names still present (expect 0 after migration) ---');
const oldNameCounts = db.pieces.aggregate([
  { $match: { part: { $in: OLD_PART_TYPES } } },
  { $group: { _id: '$part', count: { $sum: 1 } } },
  { $sort: { count: -1 } },
]).toArray();
if (oldNameCounts.length === 0) {
  print('  PASS — no old Part Type names found.');
} else {
  print('  FAIL — old names still present:');
  oldNameCounts.forEach(r => print(`    "${r._id}": ${r.count}`));
}
print('');

// ── 3. Check for any Part Type not in standardized list ───────────────────────
print('--- 3. Pieces with unrecognized Part Types (expect empty or legitimate custom types) ---');
const unknownTypes = db.pieces.aggregate([
  { $match: { part: { $nin: STANDARDIZED_PART_TYPES, $exists: true, $ne: null, $ne: '' } } },
  { $group: { _id: '$part', count: { $sum: 1 } } },
  { $sort: { count: -1 } },
  { $limit: 20 },
]).toArray();
if (unknownTypes.length === 0) {
  print('  PASS — all pieces use standardized Part Types.');
} else {
  print('  WARNING — pieces with non-standard Part Types (review manually):');
  unknownTypes.forEach(r => print(`    "${r._id}": ${r.count}`));
}
print('');

// ── 4. Bucket distribution ────────────────────────────────────────────────────
print('--- 4. Piece count by partBucket ---');
const bucketCounts = db.pieces.aggregate([
  { $group: { _id: '$partBucket', count: { $sum: 1 } } },
  { $sort: { count: -1 } },
]).toArray();
bucketCounts.forEach(r => print(`  "${r._id || '(none)'}": ${r.count}`));

const missingBucket = db.pieces.countDocuments({ partBucket: { $exists: false } });
if (missingBucket > 0) {
  print(`  WARNING — ${missingBucket} pieces have no partBucket field.`);
} else {
  print('  PASS — all pieces have partBucket field.');
}
print('');

// ── 5. Sample audit rows ──────────────────────────────────────────────────────
print('--- 5. Sample pieces for manual audit (3 per Part Type) ---');
STANDARDIZED_PART_TYPES.forEach(pt => {
  const samples = db.pieces.find(
    { part: pt },
    { part_no: 1, part: 1, partBucket: 1, category: 1, building: 1, floor: 1, flat: 1, _id: 0 },
  ).limit(3).toArray();
  if (samples.length > 0) {
    print(`  "${pt}":`);
    samples.forEach(s => print(`    ${JSON.stringify(s)}`));
  }
});
print('');

// ── 6. Total pieces summary ───────────────────────────────────────────────────
print('--- 6. Global totals ---');
const totalPieces = db.pieces.countDocuments({});
const totalProjects = db.projects.countDocuments({});
print(`  Total pieces: ${totalPieces}`);
print(`  Total projects: ${totalProjects}`);

const withStandardizedPart = db.pieces.countDocuments({ part: { $in: STANDARDIZED_PART_TYPES } });
const withOldPart = db.pieces.countDocuments({ part: { $in: OLD_PART_TYPES } });
const withNoPart = db.pieces.countDocuments({ $or: [{ part: { $exists: false } }, { part: null }, { part: '' }] });
print(`  Pieces with standardized Part Type: ${withStandardizedPart}`);
print(`  Pieces with old Part Type:          ${withOldPart}`);
print(`  Pieces with no Part Type:           ${withNoPart}`);
print(`  Pieces with other Part Type:        ${totalPieces - withStandardizedPart - withOldPart - withNoPart}`);
print('');

if (withOldPart === 0 && withStandardizedPart > 0) {
  print('OVERALL: PASS — migration looks complete.');
} else if (withOldPart > 0) {
  print('OVERALL: FAIL — old names still present. Run forward_migration.js.');
} else {
  print('OVERALL: WARNING — review above results.');
}

print('');
print('=== VERIFICATION COMPLETE ===');
