"""Planner v3: dispatch batching, family/misc inheritance, main-cap sequential batches."""
import unittest


class TestFamilySplashInheritance(unittest.TestCase):
    def test_misc_classified_splash_attaches_to_same_prefix_perimeter(self):
        from app.services.planner_v3.classify import build_families

        pieces = [
            {
                "id": 1,
                "part_no": "TEST-P-1",
                "part": "kitchen countertop",
                "notes": "",
                "building": "B1",
                "floor": "3",
                "flat": "F01",
                "length": 120,
                "width": 26,
                "stone_color": "",
            },
            {
                "id": 2,
                "part_no": "TEST-P-X",
                "part": "generic backsplash trim",
                "notes": "",
                "building": "B1",
                "floor": "3",
                "flat": "F01",
                "length": 96,
                "width": 8,
                "stone_color": "",
            },
        ]
        fams = build_families(pieces)
        misc_only_rows = [
            f for f in fams if str(f.get("category")) == "misc" and not (f.get("main_pieces") or [])
        ]
        self.assertEqual(
            len(misc_only_rows),
            0,
            "Orphan misc splash rows should inherit onto perimeter kitchen row same prefix.",
        )
        perims = [f for f in fams if f.get("category") == "perimeter"]
        self.assertTrue(perims)
        splash_ids = {p["id"] for p in perims[0].get("splash_pieces") or []}
        self.assertIn(2, splash_ids)


class TestSequentialMainCap(unittest.TestCase):
    def test_fifo_batches_split_when_main_slots_exceed_cap(self):
        from app.services.planner_v3.scored_packing import sequential_ideal_batches

        units = []
        for i in range(3):
            units.append({
                "id": i,
                "mains": [{"id": i * 10 + k} for k in range(4)],
                "total_weight_kg": 400.0,
                "flat_key": "fk",
                "material_batch_key": "m",
            })

        batches = sequential_ideal_batches(
            units,
            weight_fn=lambda u: float(u["total_weight_kg"]),
            min_kg=500.0,
            max_kg=5000.0,
            ideal_kg=900.0,
            same_flat_key_fn=lambda u: u["flat_key"],
            material_key_fn=lambda u: u["material_batch_key"],
            main_sum_fn=lambda u: len(u["mains"]),
            main_cap=10,
        )
        mains_counts = [sum(len(u["mains"]) for u in b) for b in batches]
        self.assertTrue(all(mc <= 10 for mc in mains_counts))


if __name__ == "__main__":
    unittest.main()
