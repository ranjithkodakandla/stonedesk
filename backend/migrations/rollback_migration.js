/**
 * ROLLBACK MIGRATION — Part Type Standardization
 *
 * DO NOT EXECUTE DIRECTLY.
 * Run ONLY if you need to revert the forward migration.
 * Run with: mongosh <connection-string> rollback_migration.js
 *
 * What this does:
 *   1. Restores original `part` field values from the standardized names.
 *   2. Removes the `partBucket` derived field from all pieces.
 */

// ── Reverse mapping: new Part Type → old description ─────────────────────────
// Where multiple old names mapped to the same new name, we restore the most
// common canonical form. Review the comments and adjust if your data used a
// specific variant.
const REVERSE_PART_TYPE_MAP = {
  'Kitchen - Island Tops':     'Island Tops',
  'Kitchen - Perimeter Tops':  'Perimeter Kitchen Tops',
  'Kitchen - Range Tops':      'Range Tops',
  'Kitchen - Back Splash':     'Kitchen Back Splash',
  'Kitchen - Side Splash':     'Kitchen Side Splash',
  'Vanity - Top':              'Vanity Top',
  'Vanity - Back Splash':      'Vanity Back Splash',
  'Vanity - Side Splash':      'Vanity Side Splash',
  'Misc - Full Height Splash': 'Full Height Splash',
  'Misc - Window Sill':        'Window Sill',
  'Misc - Bar Top':            'Bar Top',
};

const db = db.getSiblingDB('stonedesk'); // adjust DB name if different

print('=== ROLLBACK MIGRATION: Restore original Part Type names ===');
print('');

// Snapshot BEFORE state
const beforeTotal = db.pieces.countDocuments({});
print('BEFORE rollback — total pieces:', beforeTotal);
print('');

let totalRestored = 0;
for (const [newName, oldName] of Object.entries(REVERSE_PART_TYPE_MAP)) {
  const result = db.pieces.updateMany(
    { part: newName },
    { $set: { part: oldName }, $unset: { partBucket: '' } },
  );
  if (result.modifiedCount > 0) {
    print(`  Restored "${newName}" → "${oldName}": ${result.modifiedCount} pieces`);
    totalRestored += result.modifiedCount;
  }
}

// Remove any remaining partBucket fields (belt-and-suspenders)
const unsetResult = db.pieces.updateMany(
  { partBucket: { $exists: true } },
  { $unset: { partBucket: '' } },
);
if (unsetResult.modifiedCount > 0) {
  print(`  Removed residual partBucket from ${unsetResult.modifiedCount} pieces`);
}

print('');
print('AFTER rollback — total restored:', totalRestored);

const afterNewNames = db.pieces.countDocuments({ part: { $in: Object.keys(REVERSE_PART_TYPE_MAP) } });
if (afterNewNames === 0) {
  print('AFTER rollback — no standardized Part Type names remain.');
} else {
  print('AFTER rollback — WARNING: some standardized names still present:', afterNewNames);
}

print('');
print('=== ROLLBACK MIGRATION COMPLETE ===');
