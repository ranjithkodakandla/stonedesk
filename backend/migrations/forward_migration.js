/**
 * FORWARD MIGRATION — Part Type Standardization
 *
 * DO NOT EXECUTE DIRECTLY.
 * Review, back up production data, then run with:
 *   mongosh <connection-string> forward_migration.js
 *
 * What this does:
 *   1. Renames `part` field values on embedded piece arrays to standardized Part Type names.
 *   2. Adds a `partBucket` derived field to each embedded piece.
 *
 * Affected collections: pieces (if stored flat) and projects.planner_v3_crates (embedded).
 * The primary target is the `pieces` collection where each document has a `part` field.
 */

// ── Mapping: old description → new Part Type ──────────────────────────────────
const PART_TYPE_MAP = {
  // Island
  'Island Tops':             'Kitchen - Island Tops',
  'Island Top':              'Kitchen - Island Tops',
  // Perimeter kitchen
  'Perimeter Kitchen Tops':  'Kitchen - Perimeter Tops',
  'Perimeter Kitchen Top':   'Kitchen - Perimeter Tops',
  'Kitchen Top':             'Kitchen - Perimeter Tops',
  'Kitchen Countertop':      'Kitchen - Perimeter Tops',
  'Kitchen Perimeter':       'Kitchen - Perimeter Tops',
  // Range
  'Range Tops':              'Kitchen - Range Tops',
  'Range Top':               'Kitchen - Range Tops',
  // Kitchen splash
  'Kitchen Back Splash':     'Kitchen - Back Splash',
  'Kitchen Backsplash':      'Kitchen - Back Splash',
  'Kitchen Side Splash':     'Kitchen - Side Splash',
  // Vanity
  'Vanity Top':              'Vanity - Top',
  'Bathroom Top':            'Vanity - Top',
  'Laundry Top':             'Vanity - Top',
  'Vanity Back Splash':      'Vanity - Back Splash',
  'Vanity Backsplash':       'Vanity - Back Splash',
  'Vanity Side Splash':      'Vanity - Side Splash',
  // Misc
  'Full Height Splash':      'Misc - Full Height Splash',
  'Window Sill':             'Misc - Window Sill',
  'Bar Top':                 'Misc - Bar Top',
};

// ── Part bucket derivation ────────────────────────────────────────────────────
const PART_BUCKET_MAP = {
  'Kitchen - Island Tops':     'kitchen_islands',
  'Kitchen - Perimeter Tops':  'kitchen',
  'Kitchen - Range Tops':      'kitchen',
  'Kitchen - Back Splash':     'kitchen',
  'Kitchen - Side Splash':     'kitchen',
  'Vanity - Top':              'vanity',
  'Vanity - Back Splash':      'vanity',
  'Vanity - Side Splash':      'vanity',
  'Misc - Full Height Splash': 'misc',
  'Misc - Window Sill':        'misc',
  'Misc - Bar Top':            'misc',
};

function newPartType(oldPart) {
  if (!oldPart) return oldPart;
  return PART_TYPE_MAP[oldPart.trim()] || oldPart;
}

function partBucket(partType) {
  return PART_BUCKET_MAP[partType] || 'misc';
}

// ── Run on `pieces` collection ────────────────────────────────────────────────
// Each piece document has a `part` field (the Description / Part Type).

const db = db.getSiblingDB('stonedesk'); // adjust DB name if different

print('=== FORWARD MIGRATION: Part Type Standardization ===');
print('');

// Snapshot BEFORE state
const beforeTotal = db.pieces.countDocuments({});
const beforeCounts = {};
for (const [oldName] of Object.entries(PART_TYPE_MAP)) {
  const n = db.pieces.countDocuments({ part: oldName });
  if (n > 0) beforeCounts[oldName] = n;
}
print('BEFORE — total pieces:', beforeTotal);
print('BEFORE — pieces with old Part Type names:');
printjson(beforeCounts);
print('');

// Apply forward migration using $set with $switch expression
let totalUpdated = 0;
for (const [oldName, newName] of Object.entries(PART_TYPE_MAP)) {
  const result = db.pieces.updateMany(
    { part: oldName },
    [
      {
        $set: {
          part: newName,
          partBucket: partBucket(newName),
        },
      },
    ],
  );
  if (result.modifiedCount > 0) {
    print(`  Renamed "${oldName}" → "${newName}": ${result.modifiedCount} pieces`);
    totalUpdated += result.modifiedCount;
  }
}

// Set partBucket on any pieces that already have a new standardized name but no partBucket
for (const [newName, bucket] of Object.entries(PART_BUCKET_MAP)) {
  const result = db.pieces.updateMany(
    { part: newName, partBucket: { $exists: false } },
    { $set: { partBucket: bucket } },
  );
  if (result.modifiedCount > 0) {
    print(`  Added partBucket="${bucket}" for existing "${newName}": ${result.modifiedCount} pieces`);
    totalUpdated += result.modifiedCount;
  }
}

print('');
print('AFTER — total updated:', totalUpdated);

// Snapshot AFTER state
const afterRemaining = {};
for (const [oldName] of Object.entries(PART_TYPE_MAP)) {
  const n = db.pieces.countDocuments({ part: oldName });
  if (n > 0) afterRemaining[oldName] = n;
}
if (Object.keys(afterRemaining).length === 0) {
  print('AFTER — no old Part Type names remain in pieces collection.');
} else {
  print('AFTER — WARNING: old names still present (manual review needed):');
  printjson(afterRemaining);
}

print('');
print('=== FORWARD MIGRATION COMPLETE ===');
