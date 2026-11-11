/**
 * ROLLBACK MIGRATION — Building Type (project_type) Default Correction
 *
 * DO NOT EXECUTE DIRECTLY.
 * Run with:
 *   mongosh <connection-string> rollback_migration_project_type.js
 *
 * There is no reliable way to distinguish, after the forward migration ran,
 * which "apartment" projects were defaulted by it versus explicitly chosen
 * by a user (both end up with the same stored value, by design — the forward
 * migration only ever writes project_type where none existed). Rolling back
 * this migration therefore means clearing project_type back to unset only for
 * projects that have not been touched (created_at/updated_at) since the
 * forward migration ran. Pass the forward-migration run time as RUN_AT below
 * before executing.
 */

const RUN_AT = null; // e.g. ISODate('2026-11-10T00:00:00Z') — set before running

if (!RUN_AT) {
  print('RUN_AT is not set. Edit this script to set RUN_AT to the forward migration run timestamp, then re-run.');
  quit(1);
}

print('=== ROLLBACK MIGRATION: project_type default correction ===');
print('');

const filter = {
  project_type: 'apartment',
  updated_at: { $lte: RUN_AT },
};

const beforeCount = db.projects.countDocuments(filter);
print('Projects eligible for rollback (project_type="apartment", untouched since forward run):', beforeCount);

const result = db.projects.updateMany(filter, { $unset: { project_type: '' } });
print(`Rolled back ${result.modifiedCount} project(s): removed defaulted project_type.`);
print('');
print('=== ROLLBACK MIGRATION COMPLETE ===');
