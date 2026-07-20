from __future__ import annotations

import unittest

from fastapi import HTTPException

from solver_api import ConsecutiveConstraint, CourseRelationConstraint, DefaultRuleConfig, SmartSolveRequest, solve


def lesson(assignment: str, teacher: str, *, combined: bool = False) -> dict:
    return {
        "assignmentKey": assignment,
        "courseId": assignment,
        "teacherId": teacher,
        "name": assignment,
        "teacher": teacher,
        "teacherNames": [teacher],
        "color": "#5b8fd1",
        "isCombined": combined,
        "locked": False,
    }


def request_payload(
    *,
    class_ids: list[str],
    slot_keys: list[str],
    demands: list[dict],
    schedule_map: dict | None = None,
    fixed_slots: list[str] | None = None,
    teacher_constraints: list[dict] | None = None,
    teacher_options: dict | None = None,
) -> SmartSolveRequest:
    grids = schedule_map or {class_id: {slot: None for slot in slot_keys} for class_id in class_ids}
    return SmartSolveRequest.model_validate(
        {
            "selectedClassId": class_ids[0],
            "classIds": class_ids,
            "slotKeys": slot_keys,
            "fixedSlotKeys": fixed_slots or [],
            "defaultRules": {"enabled": False},
            "teacherHourConstraints": teacher_constraints or [],
            "teacherRuleOptions": teacher_options or {},
            "ruleOptions": {"enableGlobalFixedPoint": True},
            "scheduleMap": grids,
            "demands": demands,
        }
    )


class SolverLogicTests(unittest.TestCase):
    def test_course_distribution_is_soft_and_spreads_eight_lessons_across_five_days(self) -> None:
        slot_keys = [
            f"{period}-{day}"
            for day in ["周一", "周二", "周三", "周四", "周五"]
            for period in [1, 2]
        ]
        payload = request_payload(
            class_ids=["A"],
            slot_keys=slot_keys,
            demands=[
                {
                    "assignmentKey": "chinese",
                    "sourceClassId": "A",
                    "remaining": 8,
                    "targetClassIds": ["A"],
                    "lessonsByClass": {"A": lesson("chinese", "T")},
                    "teacherNames": ["T"],
                }
            ],
        )
        payload.defaultRules = DefaultRuleConfig(
            enabled=True,
            distribution={"enabled": True, "main": "尽量分散到不同天", "secondary": "尽量分散到不同天"},
        )

        response = solve(payload)
        placements = response["result"]["placements"]
        active_days = {item["slotKey"].split("-", 1)[1] for item in placements}

        self.assertEqual(response["result"]["remainingCount"], 0)
        self.assertEqual(len(active_days), 5)
        self.assertTrue(any("课程周分布软偏好" in row["message"] for row in response["logs"]))

    def test_prefer_no_consecutive_does_not_reduce_placement_count(self) -> None:
        payload = request_payload(
            class_ids=["A"],
            slot_keys=["1-周一", "2-周一"],
            demands=[
                {
                    "assignmentKey": "chinese",
                    "sourceClassId": "A",
                    "remaining": 2,
                    "targetClassIds": ["A"],
                    "lessonsByClass": {"A": lesson("chinese", "T")},
                    "teacherNames": ["T"],
                }
            ],
        )
        payload.defaultRules = DefaultRuleConfig(
            enabled=True,
            sameClassNoConsecutive={"enabled": True, "main": "优先不连堂", "secondary": "优先不连堂"},
        )

        response = solve(payload)

        self.assertEqual(response["result"]["remainingCount"], 0)
        self.assertEqual(len(response["result"]["placements"]), 2)

    def test_allow_cross_noon_really_disables_the_noon_boundary_constraint(self) -> None:
        payload = request_payload(
            class_ids=["A"],
            slot_keys=["1-周一", "2-周一"],
            schedule_map={
                "A": {
                    "1-周一": lesson("existing", "T"),
                    "2-周一": None,
                }
            },
            demands=[
                {
                    "assignmentKey": "math",
                    "sourceClassId": "A",
                    "remaining": 1,
                    "targetClassIds": ["A"],
                    "lessonsByClass": {"A": lesson("math", "T")},
                    "teacherNames": ["T"],
                }
            ],
        )
        payload.noonBoundaryByClass = {"A": {"morningEnd": 1, "afternoonStart": 2}}
        payload.defaultRules = DefaultRuleConfig(
            enabled=True,
            noCrossNoon={
                "enabled": True,
                "main": "可允许上午末节和下午首节连上",
                "secondary": "可允许上午末节和下午首节连上",
            },
        )

        response = solve(payload)

        self.assertEqual(response["result"]["remainingCount"], 0)
        self.assertEqual(response["result"]["placements"][0]["slotKey"], "2-周一")

    def test_sync_start_preference_allows_classes_with_different_weekly_hours(self) -> None:
        payload = request_payload(
            class_ids=["A", "B"],
            slot_keys=["1-周一", "2-周一", "1-周二", "2-周二"],
            demands=[
                {
                    "assignmentKey": "chinese-a",
                    "sourceClassId": "A",
                    "remaining": 2,
                    "targetClassIds": ["A"],
                    "lessonsByClass": {"A": lesson("chinese", "T")},
                    "teacherNames": ["T"],
                },
                {
                    "assignmentKey": "chinese-b",
                    "sourceClassId": "B",
                    "remaining": 1,
                    "targetClassIds": ["B"],
                    "lessonsByClass": {"B": lesson("chinese", "T")},
                    "teacherNames": ["T"],
                },
            ],
        )
        payload.defaultRules = DefaultRuleConfig(
            enabled=True,
            syncStart={"enabled": True, "main": "尽量一致", "secondary": "无特殊要求"},
        )

        response = solve(payload)

        self.assertEqual(response["result"]["remainingCount"], 0)
        self.assertEqual(len(response["result"]["placements"]), 3)

    def test_placement_count_has_priority_over_soft_preferences(self) -> None:
        payload = request_payload(
            class_ids=["A"],
            slot_keys=["1-周一", "2-周一"],
            fixed_slots=["1-周一"],
            teacher_constraints=[{"teacherName": "T", "weekDistribution": "周集中"}],
            teacher_options={"weekDistributionWeight": 1000},
            demands=[
                {
                    "assignmentKey": "math",
                    "sourceClassId": "A",
                    "remaining": 1,
                    "targetClassIds": ["A"],
                    "lessonsByClass": {"A": lesson("math", "T")},
                    "teacherNames": ["T"],
                }
            ],
        )

        response = solve(payload)

        self.assertEqual(response["result"]["remainingCount"], 0)
        self.assertEqual(response["result"]["placements"][0]["slotKey"], "2-周一")
        self.assertTrue(any("第一阶段完成" in row["message"] for row in response["logs"]))

    def test_teacher_consecutive_limit_is_global_across_classes(self) -> None:
        payload = request_payload(
            class_ids=["A", "B"],
            slot_keys=["1-周一", "2-周一"],
            teacher_constraints=[{"teacherName": "T", "maxConsecutiveLessons": 1}],
            demands=[
                {
                    "assignmentKey": "math-a",
                    "sourceClassId": "A",
                    "remaining": 1,
                    "targetClassIds": ["A"],
                    "lessonsByClass": {"A": lesson("math-a", "T")},
                    "teacherNames": ["T"],
                },
                {
                    "assignmentKey": "math-b",
                    "sourceClassId": "B",
                    "remaining": 1,
                    "targetClassIds": ["B"],
                    "lessonsByClass": {"B": lesson("math-b", "T")},
                    "teacherNames": ["T"],
                },
            ],
        )

        response = solve(payload)

        self.assertEqual(response["result"]["remainingCount"], 1)
        self.assertEqual(len(response["result"]["placements"]), 1)

    def test_existing_combined_lesson_counts_once_for_teacher_daily_limit(self) -> None:
        combined = lesson("club", "T", combined=True)
        payload = request_payload(
            class_ids=["A", "B"],
            slot_keys=["1-周一", "2-周一"],
            schedule_map={
                "A": {"1-周一": combined, "2-周一": None},
                "B": {"1-周一": combined, "2-周一": None},
            },
            teacher_constraints=[{"teacherName": "T", "maxDailyLessons": 2}],
            demands=[
                {
                    "assignmentKey": "math",
                    "sourceClassId": "A",
                    "remaining": 1,
                    "targetClassIds": ["A"],
                    "lessonsByClass": {"A": lesson("math", "T")},
                    "teacherNames": ["T"],
                }
            ],
        )

        response = solve(payload)

        self.assertEqual(response["result"]["remainingCount"], 0)
        self.assertEqual(response["result"]["placements"][0]["slotKey"], "2-周一")

    def test_combined_demand_checks_teachers_from_every_target_class(self) -> None:
        payload = request_payload(
            class_ids=["A", "B", "C"],
            slot_keys=["1-周一", "2-周一"],
            schedule_map={
                "A": {"1-周一": None, "2-周一": None},
                "B": {"1-周一": None, "2-周一": None},
                "C": {"1-周一": lesson("existing", "TB"), "2-周一": None},
            },
            demands=[
                {
                    "assignmentKey": "club",
                    "remaining": 1,
                    "targetClassIds": ["A", "B"],
                    "lessonsByClass": {
                        "A": lesson("club", "TA", combined=True),
                        "B": lesson("club", "TB", combined=True),
                    },
                    "teacherNames": ["TA"],
                }
            ],
        )

        response = solve(payload)

        self.assertEqual(response["result"]["remainingCount"], 0)
        self.assertEqual({item["slotKey"] for item in response["result"]["placements"]}, {"2-周一"})

    def test_unplaced_combined_unit_counts_every_target_class(self) -> None:
        payload = request_payload(
            class_ids=["A", "B"],
            slot_keys=["1-周一"],
            demands=[
                {
                    "assignmentKey": "club",
                    "remaining": 2,
                    "targetClassIds": ["A", "B"],
                    "lessonsByClass": {
                        "A": lesson("club", "TA", combined=True),
                        "B": lesson("club", "TB", combined=True),
                    },
                    "teacherNames": ["TA", "TB"],
                }
            ],
        )

        response = solve(payload)

        self.assertEqual(response["result"]["placedCount"], 2)
        self.assertEqual(response["result"]["remainingCount"], 2)

    def test_invalid_slot_key_fails_fast(self) -> None:
        payload = request_payload(
            class_ids=["A"],
            slot_keys=["周一第1节"],
            demands=[],
        )

        with self.assertRaises(HTTPException) as raised:
            solve(payload)

        self.assertEqual(raised.exception.status_code, 400)
        self.assertEqual(raised.exception.detail["code"], "INVALID_SLOT_KEY")

    def test_three_lesson_run_is_not_counted_as_two_consecutive_sessions(self) -> None:
        payload = request_payload(
            class_ids=["A"],
            slot_keys=["1-周一", "2-周一", "3-周一"],
            demands=[
                {
                    "assignmentKey": "sports",
                    "sourceClassId": "A",
                    "remaining": 3,
                    "targetClassIds": ["A"],
                    "lessonsByClass": {"A": lesson("sports", "T")},
                    "teacherNames": ["T"],
                }
            ],
        )
        payload.consecutiveConstraints = [
            ConsecutiveConstraint(
                classId="A",
                courseIds=["sports"],
                weeklyConsecutiveCount=2,
                preferredDays=[],
            )
        ]

        with self.assertRaises(HTTPException) as raised:
            solve(payload)

        self.assertEqual(raised.exception.status_code, 422)
        self.assertEqual(raised.exception.detail["code"], "ORTOOLS_INFEASIBLE")

    def test_sync_start_alternates_on_next_active_day(self) -> None:
        slots = [
            "1-周一",
            "2-周一",
            "1-周二",
            "2-周二",
            "1-周三",
            "2-周三",
        ]
        tuesday = ["1-周二", "2-周二"]
        payload = request_payload(
            class_ids=["A", "B"],
            slot_keys=slots,
            demands=[
                {
                    "assignmentKey": "math",
                    "sourceClassId": "A",
                    "remaining": 2,
                    "targetClassIds": ["A"],
                    "lessonsByClass": {"A": lesson("math", "T")},
                    "teacherNames": ["T"],
                    "forbiddenSlotsByClass": {"A": tuesday},
                },
                {
                    "assignmentKey": "math",
                    "sourceClassId": "B",
                    "remaining": 2,
                    "targetClassIds": ["B"],
                    "lessonsByClass": {"B": lesson("math", "T")},
                    "teacherNames": ["T"],
                    "forbiddenSlotsByClass": {"B": tuesday},
                },
            ],
        )
        payload.defaultRules = DefaultRuleConfig(
            enabled=True,
            syncStart={"enabled": True, "main": "启用", "secondary": "启用"},
        )

        response = solve(payload)
        placements = response["result"]["placements"]
        by_class_day = {
            (item["classId"], item["slotKey"].split("-", 1)[1]): int(item["slotKey"].split("-", 1)[0])
            for item in placements
        }

        monday_order = by_class_day[("A", "周一")] < by_class_day[("B", "周一")]
        wednesday_order = by_class_day[("A", "周三")] < by_class_day[("B", "周三")]
        self.assertNotEqual(monday_order, wednesday_order)

    def test_course_relation_previous_next_prevents_adjacent_placements(self) -> None:
        payload = request_payload(
            class_ids=["A"],
            slot_keys=["1-周一", "2-周一", "3-周一"],
            demands=[
                {
                    "assignmentKey": "course-a",
                    "sourceClassId": "A",
                    "remaining": 1,
                    "targetClassIds": ["A"],
                    "lessonsByClass": {"A": lesson("course-a", "TA")},
                    "teacherNames": ["TA"],
                },
                {
                    "assignmentKey": "course-b",
                    "sourceClassId": "A",
                    "remaining": 1,
                    "targetClassIds": ["A"],
                    "lessonsByClass": {"A": lesson("course-b", "TB")},
                    "teacherNames": ["TB"],
                },
            ],
        )
        payload.courseRelationConstraints = [
            CourseRelationConstraint(
                classId="A",
                courseAIds=["course-a"],
                courseBIds=["course-b"],
                relationType="前后互斥",
            )
        ]

        response = solve(payload)
        periods = sorted(int(item["slotKey"].split("-", 1)[0]) for item in response["result"]["placements"])

        self.assertEqual(response["result"]["remainingCount"], 0)
        self.assertEqual(periods, [1, 3])

    def test_course_relation_same_day_places_courses_on_different_days(self) -> None:
        payload = request_payload(
            class_ids=["A"],
            slot_keys=["1-周一", "2-周一", "1-周二", "2-周二"],
            demands=[
                {
                    "assignmentKey": "course-a",
                    "sourceClassId": "A",
                    "remaining": 1,
                    "targetClassIds": ["A"],
                    "lessonsByClass": {"A": lesson("course-a", "TA")},
                    "teacherNames": ["TA"],
                },
                {
                    "assignmentKey": "course-b",
                    "sourceClassId": "A",
                    "remaining": 1,
                    "targetClassIds": ["A"],
                    "lessonsByClass": {"A": lesson("course-b", "TB")},
                    "teacherNames": ["TB"],
                },
            ],
        )
        payload.courseRelationConstraints = [
            CourseRelationConstraint(
                classId="A",
                courseAIds=["course-a"],
                courseBIds=["course-b"],
                relationType="同天互斥",
            )
        ]

        response = solve(payload)
        days = {item["slotKey"].split("-", 1)[1] for item in response["result"]["placements"]}

        self.assertEqual(response["result"]["remainingCount"], 0)
        self.assertEqual(days, {"周一", "周二"})

    def test_existing_course_relation_conflict_fails_fast(self) -> None:
        payload = request_payload(
            class_ids=["A"],
            slot_keys=["1-周一", "2-周一", "3-周一"],
            schedule_map={
                "A": {
                    "1-周一": lesson("course-a", "TA"),
                    "2-周一": lesson("course-b", "TB"),
                    "3-周一": None,
                }
            },
            demands=[
                {
                    "assignmentKey": "course-c",
                    "sourceClassId": "A",
                    "remaining": 1,
                    "targetClassIds": ["A"],
                    "lessonsByClass": {"A": lesson("course-c", "TC")},
                    "teacherNames": ["TC"],
                }
            ],
        )
        payload.courseRelationConstraints = [
            CourseRelationConstraint(
                classId="A",
                courseAIds=["course-a"],
                courseBIds=["course-b"],
                relationType="前后互斥",
            )
        ]

        with self.assertRaises(HTTPException) as raised:
            solve(payload)

        self.assertEqual(raised.exception.status_code, 422)
        self.assertEqual(raised.exception.detail["code"], "COURSE_RELATION_EXISTING_CONFLICT")


if __name__ == "__main__":
    unittest.main()
