/**
 * FORWARD MIGRATION — Building Type (project_type) Default Correction
 *
 * DO NOT EXECUTE DIRECTLY.
 * Review, back up production data, then run with:
 *   mongosh <connection-string> forward_migration_project_type.js
 *
 * What this does:
 *   Sets `project_type` to "apartment" on any project document where it is
 *   missing, null, or an empty string. Projects that already have an explicit
 *   value ("apartment" or "house") are left completely untouched, as are all
 *   other fields on every document.
 *
 * Idempotent: running this script more than once has no further effect —
 * after the first run, no project matches the "empty/missing" filter anymore,
 * so subsequent runs update 0 documents.
 *
 * Affected collection: projects.
 */

const EMPTY_FILTER = {
  $or: [
    { project_type: { $exists: false } },
    { project_type: null },
    { project_type: '' },
  ],
};

print('=== FORWARD MIGRATION: project_type default correction ===');
print('');

const beforeTotal = db.projects.countDocuments({});
const beforeEmpty = db.projects.countDocuments(EMPTY_FILTER);
const beforeApartment = db.projects.countDocuments({ project_type: 'apartment' });
const beforeHouse = db.projects.countDocuments({ project_type: 'house' });

print('BEFORE — total projects:', beforeTotal);
print('BEFORE — empty/missing project_type:', beforeEmpty);
print('BEFORE — already "apartment":', beforeApartment);
print('BEFORE — already "house":', beforeHouse);
print('');

const result = db.projects.updateMany(EMPTY_FILTER, { $set: { project_type: 'apartment' } });
print(`Updated ${result.modifiedCount} project(s): empty/missing project_type -> "apartment"`);
print('');

const afterEmpty = db.projects.countDocuments(EMPTY_FILTER);
const afterApartment = db.projects.countDocuments({ project_type: 'apartment' });
const afterHouse = db.projects.countDocuments({ project_type: 'house' });

print('AFTER — empty/missing project_type:', afterEmpty);
print('AFTER — "apartment":', afterApartment);
print('AFTER — "house":', afterHouse);

if (afterEmpty === 0) {
  print('AFTER — no projects remain without an explicit project_type.');
} else {
  print('AFTER — WARNING: projects still missing project_type (manual review needed).');
}

if (afterHouse !== beforeHouse) {
  print('AFTER — WARNING: house count changed unexpectedly; this migration must never alter house records.');
}

print('');
print('=== FORWARD MIGRATION COMPLETE ===');
