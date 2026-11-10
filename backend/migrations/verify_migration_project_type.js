/**
 * VERIFY MIGRATION — Building Type (project_type) Default Correction
 *
 * Read-only sanity check. Run with:
 *   mongosh <connection-string> verify_migration_project_type.js
 */

print('=== VERIFY: project_type default correction ===');
print('');

const total = db.projects.countDocuments({});
const empty = db.projects.countDocuments({
  $or: [
    { project_type: { $exists: false } },
    { project_type: null },
    { project_type: '' },
  ],
});
const apartment = db.projects.countDocuments({ project_type: 'apartment' });
const house = db.projects.countDocuments({ project_type: 'house' });
const other = total - empty - apartment - house;

print('Total projects:', total);
print('Empty/missing project_type:', empty);
print('"apartment":', apartment);
print('"house":', house);
print('Other/unexpected values:', other);
print('');

if (empty === 0) {
  print('PASS: every project has an explicit project_type.');
} else {
  print('FAIL: projects remain with empty/missing project_type — run forward_migration_project_type.js.');
}

if (other > 0) {
  print('WARNING: found project_type values other than "apartment"/"house":');
  db.projects
    .find({ project_type: { $nin: ['apartment', 'house'] } }, { id: 1, name: 1, project_type: 1, _id: 0 })
    .forEach((doc) => printjson(doc));
}
