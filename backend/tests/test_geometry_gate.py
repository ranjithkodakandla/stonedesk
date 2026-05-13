"""Geometry manifest gate + summary KPIs for rejected crates."""
import unittest


class TestPartitionCratesForManifest(unittest.TestCase):
    def test_oversized_horizontal_goes_to_rejected(self):
        from app.services.planner_v3.geometry_gate import partition_crates_for_manifest

        project = {"thickness": "3CM", "crate_wood_thickness": 1.5}
        bad = {
            "serial": "X1",
            "orientation": "horizontal",
            "dimensions": {"external_length": 300.0, "external_width": 50.0, "external_height": 40.0},
            "pieces": [{"id": 1}],
            "planner_debug": {},
        }
        good = {
            "serial": "X2",
            "orientation": "horizontal",
            "dimensions": {"external_length": 100.0, "external_width": 50.0, "external_height": 40.0},
            "pieces": [{"id": 2}],
            "planner_debug": {},
        }
        manifest, rejected, _rows = partition_crates_for_manifest([bad, good], project=project)
        self.assertEqual(len(manifest), 1)
        self.assertEqual(len(rejected), 1)
        self.assertTrue(manifest[0].get("planner_manifest_eligible"))
        self.assertIs(rejected[0].get("planner_manifest_eligible"), False)

    def test_summary_counts_unshippable_pieces_from_rejected_only(self):
        from app.services.planner_v3.summary_metrics import build_planner_summary

        pieces = [{"id": 1}, {"id": 2}, {"id": 99}]
        manifest_crates = [
            {
                "category": "misc",
                "total_weight_kg": 100.0,
                "dimensions": {"external_length": 10, "external_width": 10, "external_height": 10},
            }
        ]
        rejected = [
            {"pieces": [{"id": 99}], "serial": "R1"},
        ]
        containers_result = {"containers": [], "warnings": []}
        summary = build_planner_summary(
            pieces,
            manifest_crates,
            containers_result,
            material="Granite",
            thickness="3CM",
            color="",
            rejected_crates=rejected,
            manifest_notes={
                "manifest_eligible_crate_count": 1,
                "rejected_manifest_crate_count": 1,
            },
        )
        self.assertEqual(summary["unshippable_manifest_piece_count"], 1)
        self.assertEqual(summary["manifest_eligible_crate_count"], 1)
        self.assertEqual(summary["rejected_manifest_crate_count"], 1)


class TestIslandVerticalEnvelope(unittest.TestCase):
    def test_island_vertical_uses_rotated_box_not_clear_height_only(self):
        from app.services.planner_v3.container_layout import CONTAINER_20FT
        from app.services.planner_v3.geometry_gate import validate_crate_geometry

        crate = {
            "orientation": "vertical",
            "category": "island",
            "main_pieces": [{"id": 1}],
            "dimensions": {"external_length": 42.0, "external_width": 52.0, "external_height": 128.0},
        }
        gv = validate_crate_geometry(crate, interior=dict(CONTAINER_20FT))
        self.assertEqual(gv["outcome"], "valid")
        self.assertEqual(gv.get("island_envelope_check"), "oriented_box_20ft")

    def test_vertical_non_island_uses_legacy_height_and_footprint(self):
        from app.services.planner_v3.container_layout import CONTAINER_20FT
        from app.services.planner_v3.geometry_gate import validate_crate_geometry

        crate = {
            "orientation": "vertical",
            "category": "range",
            "main_pieces": [{"id": 1}],
            "dimensions": {"external_length": 42.0, "external_width": 52.0, "external_height": 128.0},
        }
        gv = validate_crate_geometry(crate, interior=dict(CONTAINER_20FT))
        self.assertEqual(gv["outcome"], "rejected")
        self.assertIn("vertical_height_exceeds_clearance", gv.get("errors") or [])

    def test_emit_gate_skips_height_reject_for_island_vertical(self):
        from app.services.planner_v3.emit_gate import evaluate_emit_gate

        crate = {
            "category": "island",
            "orientation": "vertical",
            "crate_class": "A",
            "total_weight_kg": 1800,
            "max_weight": 2200,
            "dimensions": {"external_height": 130},
            "main_pieces": [{"id": 1}],
        }
        verdict, _msgs = evaluate_emit_gate(crate, is_final_remainder=False)
        self.assertNotEqual(verdict, "reject_height")

    def test_classify_respects_explicit_island_category_over_description(self):
        from app.services.planner_v3.classify import classify_piece

        piece = {
            "id": 1,
            "category": "Island",
            "part": "Kitchen / Vanity",
            "length": 112,
            "width": 44,
            "thickness": "3CM",
        }
        cat, is_sp = classify_piece(piece)
        self.assertEqual(cat, "island")
        self.assertFalse(is_sp)


class TestPrefixNormalization(unittest.TestCase):
    def test_short_prefix_fuse(self):
        from app.services.planner_v3.classify import normalize_part_number_token

        fused, note = normalize_part_number_token("1-51-08")
        self.assertEqual(fused, "1051-08")
        self.assertIsNotNone(note)
        self.assertIn("1-51-08", note)


if __name__ == "__main__":
    unittest.main()
