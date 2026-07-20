from __future__ import annotations

from datetime import datetime
from time import perf_counter
from typing import Any

from fastapi import FastAPI, HTTPException
from ortools.sat.python import cp_model
from pydantic import BaseModel, Field


class SolverLesson(BaseModel):
    assignmentKey: str
    courseId: str
    courseIds: list[str] | None = None
    teacherId: str = ""
    name: str = ""
    teacher: str = ""
    teacherNames: list[str] | None = None
    color: str = "#5b8fd1"
    isCombined: bool | None = None
    isOddEven: bool | None = None
    oddCourseId: str | None = None
    evenCourseId: str | None = None
    oddCourseName: str | None = None
    evenCourseName: str | None = None
    locked: bool | None = None


class SolveDemand(BaseModel):
    assignmentKey: str
    sourceClassId: str | None = None
    remaining: int = 0
    targetClassIds: list[str] = Field(default_factory=list)
    lessonsByClass: dict[str, SolverLesson] = Field(default_factory=dict)
    teacherNames: list[str] = Field(default_factory=list)
    forbiddenSlotsByClass: dict[str, list[str]] | None = None


class DefaultRuleConfig(BaseModel):
    enabled: bool | None = None
    mainCourseIds: list[str] | None = None
    secondaryCourseIds: list[str] | None = None
    syncStart: dict[str, Any] | None = None
    distribution: dict[str, Any] | None = None
    noCrossNoon: dict[str, Any] | None = None
    sameClassNoConsecutive: dict[str, Any] | None = None
    twoLessonsGap: dict[str, Any] | None = None


class TeacherHourConstraint(BaseModel):
    teacherName: str
    maxDailyLessons: int | None = None
    maxConsecutiveLessons: int | None = None
    weekDistribution: str | None = None
    dayDistribution: str | None = None


class TeacherMutualConstraint(BaseModel):
    teacherGroupA: list[str] = Field(default_factory=list)
    teacherGroupB: list[str] = Field(default_factory=list)


class TeacherRuleOptions(BaseModel):
    enableTeacherMutual: bool | None = None
    weekDistributionWeight: int | None = None
    dayDistributionWeight: int | None = None


class RuleOptions(BaseModel):
    enableGlobalFixedPoint: bool | None = None
    enableCombineCourse: bool | None = None
    enableCourseArea: bool | None = None
    enableCourseBan: bool | None = None
    enableCourseDefault: bool | None = None
    enableMainSecondary: bool | None = None
    enableOddEven: bool | None = None
    enableCourseRelation: bool | None = None
    consecutivePreferredWeight: int | None = None


class ConsecutiveConstraint(BaseModel):
    classId: str
    courseIds: list[str] = Field(default_factory=list)
    weeklyConsecutiveCount: int = 0
    preferredDays: list[str] = Field(default_factory=list)


class CourseRelationConstraint(BaseModel):
    classId: str
    courseAIds: list[str] = Field(default_factory=list)
    courseBIds: list[str] = Field(default_factory=list)
    relationType: str


class SmartSolveRequest(BaseModel):
    selectedClassId: str
    classIds: list[str]
    slotKeys: list[str]
    fixedSlotKeys: list[str] | None = None
    defaultRules: DefaultRuleConfig | None = None
    noonBoundaryByClass: dict[str, dict[str, int]] | None = None
    teacherHourConstraints: list[TeacherHourConstraint] | None = None
    teacherMutualConstraints: list[TeacherMutualConstraint] | None = None
    teacherRuleOptions: TeacherRuleOptions | None = None
    ruleOptions: RuleOptions | None = None
    consecutiveConstraints: list[ConsecutiveConstraint] | None = None
    courseRelationConstraints: list[CourseRelationConstraint] | None = None
    scheduleMap: dict[str, dict[str, SolverLesson | None]]
    demands: list[SolveDemand]


app = FastAPI(title="schedule-cpsat-solver", version="0.1.0")


def norm_teachers(raw: Any) -> list[str]:
    if isinstance(raw, list):
        values = [str(x).strip() for x in raw]
    else:
        values = [x.strip() for x in str(raw or "").split("/")]
    return sorted({x for x in values if x and x != "未设置教师"})


def lesson_teachers(lesson: SolverLesson | None) -> list[str]:
    if lesson is None:
        return []
    from_list = norm_teachers(lesson.teacherNames or [])
    if from_list:
        return from_list
    return norm_teachers(lesson.teacher)


def lesson_course_ids(lesson: SolverLesson | None) -> set[str]:
    if lesson is None:
        return set()
    values = lesson.courseIds or []
    if not values:
        values = [lesson.courseId or lesson.assignmentKey]
    return {str(value or "").strip() for value in values if str(value or "").strip()}


def sync_teacher_key(teachers: list[str]) -> str:
    clean = [str(t or "").strip() for t in teachers if str(t or "").strip()]
    if not clean:
        return ""
    # Teacher-based sync key for "教案齐头" constraints.
    return "/".join(sorted(dict.fromkeys(clean)))


def parse_slot(slot_key: str) -> tuple[int, str] | None:
    text = str(slot_key or "").strip()
    if not text or "-" not in text:
        return None
    raw_period, raw_day = text.split("-", 1)
    try:
        period = int(raw_period)
    except Exception:
        return None
    day = raw_day.strip()
    if period <= 0 or not day:
        return None
    return period, day


def rule_pair_value(rule: dict[str, Any] | None, course_id: str, main_ids: set[str], secondary_ids: set[str]) -> str:
    if not isinstance(rule, dict) or not bool(rule.get("enabled")):
        return ""
    main_text = str(rule.get("main") or "").strip()
    secondary_text = str(rule.get("secondary") or "").strip()
    has_main_secondary_split = bool(main_ids) or bool(secondary_ids)
    if course_id in main_ids:
        return main_text
    if course_id in secondary_ids:
        return secondary_text
    if has_main_secondary_split:
        # When main/secondary sets are configured, only classified courses should hit pair rules.
        return ""
    return main_text or secondary_text


def rule_pair_has_value(
    rule: dict[str, Any] | None,
    course_id: str,
    main_ids: set[str],
    secondary_ids: set[str],
    accepted: set[str],
) -> bool:
    return rule_pair_value(rule, course_id, main_ids, secondary_ids) in accepted


def option_bool(options: dict[str, Any], key: str, default: bool) -> bool:
    value = options.get(key)
    return default if value is None else bool(value)


def option_int(options: dict[str, Any], key: str, default: int) -> int:
    value = options.get(key)
    if value is None:
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


@app.post("/solve-cpsat")
def solve(payload: SmartSolveRequest):
    logs: list[dict[str, str]] = []
    def push_log(phase: str, message: str) -> None:
        logs.append({"phase": phase, "message": message, "at": datetime.now().isoformat()})

    class_ids = list(dict.fromkeys(str(c or "").strip() for c in payload.classIds if str(c or "").strip()))
    if not class_ids:
        raise HTTPException(status_code=400, detail="classIds is empty")
    slot_keys = list(dict.fromkeys(str(s or "").strip() for s in payload.slotKeys if str(s or "").strip()))
    if not slot_keys:
        raise HTTPException(status_code=400, detail="slotKeys is empty")
    invalid_slot_keys = [slot for slot in slot_keys if parse_slot(slot) is None]
    if invalid_slot_keys:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "INVALID_SLOT_KEY",
                "message": "节次槽位格式不正确，应使用“节次-星期”格式。",
                "slots": invalid_slot_keys[:10],
            },
        )

    rule_options = payload.ruleOptions.model_dump() if payload.ruleOptions else {}
    enable_global_fixed_point = option_bool(rule_options, "enableGlobalFixedPoint", True)
    enable_combine_course = option_bool(rule_options, "enableCombineCourse", True)
    enable_course_area = option_bool(rule_options, "enableCourseArea", True)
    enable_course_ban = option_bool(rule_options, "enableCourseBan", True)
    enable_course_default = option_bool(rule_options, "enableCourseDefault", True)
    enable_main_secondary = option_bool(rule_options, "enableMainSecondary", True)
    enable_odd_even = option_bool(rule_options, "enableOddEven", True)
    enable_course_relation = option_bool(rule_options, "enableCourseRelation", True)
    fixed_set = set(payload.fixedSlotKeys or []) if enable_global_fixed_point else set()
    push_log(
        "规则",
        "规则开关："
        + f"固定点={'开' if enable_global_fixed_point else '关'}"
        + f"，合班课={'开' if enable_combine_course else '关'}"
        + f"，课程区域={'开' if enable_course_area else '关'}"
        + f"，课程禁排={'开' if enable_course_ban else '关'}"
        + f"，课程默认={'开' if enable_course_default else '关'}"
        + f"，主副科={'开' if enable_main_secondary else '关'}"
        + f"，单双周={'开' if enable_odd_even else '关'}"
        + f"，课程关系={'开' if enable_course_relation else '关'}"
        + f"，固定点命中={len(fixed_set)}。",
    )
    class_set = set(class_ids)
    slot_index_map = {slot: idx for idx, slot in enumerate(slot_keys)}
    slot_meta = {slot: parse_slot(slot) for slot in slot_keys}
    slots_by_day: dict[str, list[tuple[int, int, str]]] = {}
    for s_idx, slot in enumerate(slot_keys):
        meta = slot_meta.get(slot)
        if not meta:
            continue
        period, day = meta
        slots_by_day.setdefault(day, []).append((period, s_idx, slot))
    for day in slots_by_day:
        slots_by_day[day].sort(key=lambda item: item[0])

    # existing occupancy and teacher occupancy on each slot
    occupied: dict[tuple[str, str], bool] = {}
    existing_teacher_occ: dict[tuple[str, str], int] = {}
    existing_teacher_occ_by_day: dict[tuple[str, str], int] = {}
    for class_id in class_ids:
        grid = payload.scheduleMap.get(class_id, {})
        for slot in slot_keys:
            lesson = grid.get(slot)
            occupied[(class_id, slot)] = lesson is not None
            for t in lesson_teachers(lesson):
                # 合班课会在多个班级单元格中重复保存；教师占用应按“教师+节次”去重。
                existing_teacher_occ[(t, slot)] = 1
    for teacher, slot in existing_teacher_occ:
        meta = slot_meta.get(slot)
        if not meta:
            continue
        day = meta[1]
        key = (teacher, day)
        existing_teacher_occ_by_day[key] = existing_teacher_occ_by_day.get(key, 0) + 1

    day_order = {"周一": 1, "周二": 2, "周三": 3, "周四": 4, "周五": 5, "周六": 6, "周日": 7}
    default_rules_raw = payload.defaultRules.model_dump() if payload.defaultRules else {}
    default_rules_enabled = option_bool(default_rules_raw, "enabled", True)
    main_course_ids = {str(x).strip() for x in (default_rules_raw.get("mainCourseIds") or []) if str(x).strip()}
    secondary_course_ids = {str(x).strip() for x in (default_rules_raw.get("secondaryCourseIds") or []) if str(x).strip()}
    noon_boundary_by_class = payload.noonBoundaryByClass or {}

    # expand demand units
    units: list[dict[str, Any]] = []
    for d_idx, demand in enumerate(payload.demands):
        rem = max(0, int(demand.remaining or 0))
        target_ids = [c for c in dict.fromkeys(demand.targetClassIds) if c in class_set]
        if not target_ids:
            target_ids = [next((k for k in demand.lessonsByClass.keys() if k in class_set), "")]
            target_ids = [x for x in target_ids if x]
        if not target_ids:
            continue

        missing_lessons = [class_id for class_id in target_ids if demand.lessonsByClass.get(class_id) is None]
        if missing_lessons:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "MISSING_LESSON_TEMPLATE",
                    "message": "课程需求缺少目标班级的课程模板。",
                    "assignmentKey": demand.assignmentKey,
                    "classIds": missing_lessons,
                },
            )

        # Always include teachers from every target class. For combined lessons,
        # demand.teacherNames may only describe the source class.
        teacher_set = set(norm_teachers(demand.teacherNames))
        for c in target_ids:
            item = demand.lessonsByClass.get(c)
            if item:
                teacher_set.update(lesson_teachers(item))
        demand_teachers = sorted(teacher_set)

        forbidden_map = demand.forbiddenSlotsByClass or {}
        build_blockers = {
            "fixed": 0,
            "classOccupied": 0,
            "forbidden": 0,
            "teacherOccupied": 0,
        }
        allowed_slots: list[str] = []
        for slot in slot_keys:
            if slot in fixed_set:
                build_blockers["fixed"] += 1
                continue
            if any(occupied.get((c, slot), False) for c in target_ids):
                build_blockers["classOccupied"] += 1
                continue
            if any(slot in (forbidden_map.get(c) or []) for c in target_ids):
                build_blockers["forbidden"] += 1
                continue
            # teacher already occupied in existing schedule at this slot
            if any(existing_teacher_occ.get((t, slot), 0) > 0 for t in demand_teachers):
                build_blockers["teacherOccupied"] += 1
                continue
            allowed_slots.append(slot)

        for u in range(rem):
            units.append(
                {
                    "id": f"{d_idx}-{u}",
                    "demand": demand,
                    "target_ids": target_ids,
                    "teachers": demand_teachers,
                    "sync_teacher_key": sync_teacher_key(demand_teachers),
                    "allowed_slots": allowed_slots,
                    "build_blockers": build_blockers,
                    "course_key_by_class": {
                        c: (
                            (demand.lessonsByClass.get(c).courseId if demand.lessonsByClass.get(c) else "")
                            or demand.assignmentKey
                            or "unknown"
                        )
                        for c in target_ids
                    },
                    "course_id_by_class": {
                        c: (
                            (demand.lessonsByClass.get(c).courseId if demand.lessonsByClass.get(c) else "")
                            or demand.assignmentKey
                            or "unknown"
                        )
                        for c in target_ids
                    },
                    "course_ids_by_class": {
                        c: sorted(
                            lesson_course_ids(demand.lessonsByClass.get(c))
                            or {
                                (demand.lessonsByClass.get(c).courseId if demand.lessonsByClass.get(c) else "")
                                or demand.assignmentKey
                                or "unknown"
                            }
                        )
                        for c in target_ids
                    },
                    "display_course": (
                        next(
                            (
                                str((demand.lessonsByClass.get(c).name if demand.lessonsByClass.get(c) else "") or "").strip()
                                for c in target_ids
                                if str((demand.lessonsByClass.get(c).name if demand.lessonsByClass.get(c) else "") or "").strip()
                            ),
                            "",
                        )
                        or str(demand.assignmentKey or "").strip()
                    ),
                }
            )

    demand_count = len(payload.demands)
    multi_class_demands = sum(1 for item in payload.demands if len([c for c in dict.fromkeys(item.targetClassIds or []) if c in class_set]) > 1)
    demands_with_forbidden = 0
    total_forbidden_slots = 0
    for item in payload.demands:
        forbidden_map = item.forbiddenSlotsByClass or {}
        slot_count = sum(len(v or []) for v in forbidden_map.values())
        if slot_count > 0:
            demands_with_forbidden += 1
            total_forbidden_slots += slot_count
    push_log(
        "规则",
        f"需求展开：原始需求={demand_count}，待排单元={len(units)}，多班联排需求={multi_class_demands}，携带禁排需求={demands_with_forbidden}（禁排槽位总计={total_forbidden_slots}）。",
    )

    if not units:
        return {"ok": True, "result": {"placements": [], "placedCount": 0, "remainingCount": 0}, "logs": logs}

    model = cp_model.CpModel()
    x: dict[tuple[int, int], cp_model.IntVar] = {}

    for u_idx, unit in enumerate(units):
        for s_idx, slot in enumerate(slot_keys):
            if slot in unit["allowed_slots"]:
                x[(u_idx, s_idx)] = model.NewBoolVar(f"x_{u_idx}_{s_idx}")

    # each unit at most one slot
    for u_idx, _ in enumerate(units):
        vars_u = [var for (uu, _), var in x.items() if uu == u_idx]
        if vars_u:
            model.Add(sum(vars_u) <= 1)

    # class-slot cannot host multiple new units
    for class_id in class_ids:
        for s_idx, slot in enumerate(slot_keys):
            vars_cs: list[cp_model.IntVar] = []
            for u_idx, unit in enumerate(units):
                if class_id in unit["target_ids"] and (u_idx, s_idx) in x:
                    vars_cs.append(x[(u_idx, s_idx)])
            if vars_cs:
                model.Add(sum(vars_cs) <= 1)

    # teacher-slot conflict across new units + existing occupancy
    all_teachers = sorted({t for unit in units for t in unit["teachers"]})
    for teacher in all_teachers:
        for s_idx, slot in enumerate(slot_keys):
            vars_ts: list[cp_model.IntVar] = []
            for u_idx, unit in enumerate(units):
                if teacher in unit["teachers"] and (u_idx, s_idx) in x:
                    vars_ts.append(x[(u_idx, s_idx)])
            cap = 1 - (1 if existing_teacher_occ.get((teacher, slot), 0) > 0 else 0)
            if vars_ts:
                if cap <= 0:
                    for var in vars_ts:
                        model.Add(var == 0)
                else:
                    model.Add(sum(vars_ts) <= cap)

    teacher_rule_options = payload.teacherRuleOptions.model_dump() if payload.teacherRuleOptions else {}
    enable_teacher_mutual = option_bool(teacher_rule_options, "enableTeacherMutual", True)
    week_distribution_weight = option_int(teacher_rule_options, "weekDistributionWeight", 45)
    day_distribution_weight = option_int(teacher_rule_options, "dayDistributionWeight", 25)
    week_distribution_weight = max(0, min(1000, week_distribution_weight))
    day_distribution_weight = max(0, min(1000, day_distribution_weight))

    teacher_mutual_constraints: list[dict[str, set[str]]] = []
    if enable_teacher_mutual:
        for item in payload.teacherMutualConstraints or []:
            group_a = {str(name or "").strip() for name in item.teacherGroupA or [] if str(name or "").strip()}
            group_b = {str(name or "").strip() for name in item.teacherGroupB or [] if str(name or "").strip()}
            if not group_a or not group_b:
                continue
            overlap = group_a & group_b
            if overlap:
                group_a = group_a - overlap
                group_b = group_b - overlap
            if not group_a or not group_b:
                continue
            teacher_mutual_constraints.append({"groupA": group_a, "groupB": group_b})

    if teacher_mutual_constraints:
        for s_idx, slot in enumerate(slot_keys):
            existing_teachers_at_slot: set[str] = set()
            for class_id in class_ids:
                lesson = payload.scheduleMap.get(class_id, {}).get(slot)
                if lesson is None:
                    continue
                for teacher in lesson_teachers(lesson):
                    existing_teachers_at_slot.add(teacher)
            for relation_idx, relation in enumerate(teacher_mutual_constraints):
                group_a = relation["groupA"]
                group_b = relation["groupB"]
                existing_a = 1 if any(name in existing_teachers_at_slot for name in group_a) else 0
                existing_b = 1 if any(name in existing_teachers_at_slot for name in group_b) else 0
                vars_a: list[cp_model.IntVar] = []
                vars_b: list[cp_model.IntVar] = []
                for u_idx, unit in enumerate(units):
                    if (u_idx, s_idx) not in x:
                        continue
                    unit_teachers = set(unit["teachers"])
                    if unit_teachers & group_a:
                        vars_a.append(x[(u_idx, s_idx)])
                    if unit_teachers & group_b:
                        vars_b.append(x[(u_idx, s_idx)])
                lhs_a: cp_model.LinearExpr | int = existing_a
                lhs_b: cp_model.LinearExpr | int = existing_b
                if vars_a:
                    lhs_a = lhs_a + sum(vars_a) if isinstance(lhs_a, int) else lhs_a + sum(vars_a)
                if vars_b:
                    lhs_b = lhs_b + sum(vars_b) if isinstance(lhs_b, int) else lhs_b + sum(vars_b)
                if isinstance(lhs_a, int) and isinstance(lhs_b, int):
                    if lhs_a + lhs_b > 1:
                        model.Add(0 == 1)
                    continue
                model.Add(lhs_a + lhs_b <= 1)
        push_log("规则", f"教师互斥约束：加入 {len(teacher_mutual_constraints)} 组。")

    teacher_hour_constraints = {}
    for item in payload.teacherHourConstraints or []:
        teacher_name = str(item.teacherName or "").strip()
        if not teacher_name:
            continue
        max_daily = int(item.maxDailyLessons) if item.maxDailyLessons is not None else None
        max_consecutive = int(item.maxConsecutiveLessons) if item.maxConsecutiveLessons is not None else None
        week_distribution = str(item.weekDistribution or "").strip()
        day_distribution = str(item.dayDistribution or "").strip()
        if max_daily is not None and max_daily <= 0:
            max_daily = None
        if max_consecutive is not None and max_consecutive <= 0:
            max_consecutive = None
        if week_distribution not in ("周分散", "周集中"):
            week_distribution = None
        if day_distribution not in ("日分散", "日集中"):
            day_distribution = None
        if max_daily is None and max_consecutive is None and week_distribution is None and day_distribution is None:
            continue
        teacher_hour_constraints[teacher_name] = {
            "maxDailyLessons": max_daily,
            "maxConsecutiveLessons": max_consecutive,
            "weekDistribution": week_distribution,
            "dayDistribution": day_distribution,
        }

    # teacher daily max
    for teacher, conf in teacher_hour_constraints.items():
        max_daily = conf.get("maxDailyLessons")
        if max_daily is None:
            continue
        for day, slots in slots_by_day.items():
            vars_day: list[cp_model.IntVar] = []
            for _, s_idx, _ in slots:
                for u_idx, unit in enumerate(units):
                    if teacher in unit["teachers"] and (u_idx, s_idx) in x:
                        vars_day.append(x[(u_idx, s_idx)])
            existing_day = existing_teacher_occ_by_day.get((teacher, day), 0)
            rhs = max_daily - existing_day
            if vars_day:
                if rhs < 0:
                    rhs = 0
                model.Add(sum(vars_day) <= rhs)

    # teacher max consecutive lessons across all classes.
    # A teacher moving between classes still counts as consecutive teaching;
    # combined-class variables are deduplicated by (unit, slot).
    teacher_consecutive_constraints = 0
    for teacher, conf in teacher_hour_constraints.items():
        max_consecutive = conf.get("maxConsecutiveLessons")
        if max_consecutive is None:
            continue
        window_size = max_consecutive + 1
        for _day, slots in slots_by_day.items():
            if len(slots) < window_size:
                continue
            for start in range(0, len(slots) - window_size + 1):
                window = slots[start : start + window_size]
                var_indexes: set[tuple[int, int]] = set()
                existing_window = 0
                for _, s_idx, slot in window:
                    existing_window += int(existing_teacher_occ.get((teacher, slot), 0) > 0)
                    for u_idx, unit in enumerate(units):
                        if teacher in unit["teachers"] and (u_idx, s_idx) in x:
                            var_indexes.add((u_idx, s_idx))
                if not var_indexes:
                    continue
                rhs = max(0, max_consecutive - existing_window)
                model.Add(sum(x[index] for index in sorted(var_indexes)) <= rhs)
                teacher_consecutive_constraints += 1
    push_log("规则", f"教师连续课时硬约束：新增 {teacher_consecutive_constraints} 条（跨班级统一计算）。")

    existing_by_class_course_day: dict[tuple[str, str, str], int] = {}
    existing_by_class_course_day_teacher: dict[tuple[str, str, str, str], int] = {}
    existing_by_class_course_slot: dict[tuple[str, str, str], int] = {}
    existing_by_class_course_slot_teacher: dict[tuple[str, str, str, str], int] = {}
    existing_by_class_course_total: dict[tuple[str, str], int] = {}
    for class_id in class_ids:
        grid = payload.scheduleMap.get(class_id, {})
        for slot in slot_keys:
            lesson = grid.get(slot)
            if lesson is None:
                continue
            meta = slot_meta.get(slot)
            if not meta:
                continue
            _, day = meta
            course_key = str(lesson.courseId or lesson.assignmentKey or "").strip()
            if not course_key:
                continue
            key_day = (class_id, course_key, day)
            key_slot = (class_id, course_key, slot)
            key_total = (class_id, course_key)
            existing_by_class_course_day[key_day] = existing_by_class_course_day.get(key_day, 0) + 1
            existing_by_class_course_slot[key_slot] = existing_by_class_course_slot.get(key_slot, 0) + 1
            existing_by_class_course_total[key_total] = existing_by_class_course_total.get(key_total, 0) + 1
            for teacher in lesson_teachers(lesson):
                key_day_teacher = (class_id, course_key, day, teacher)
                key_slot_teacher = (class_id, course_key, slot, teacher)
                existing_by_class_course_day_teacher[key_day_teacher] = existing_by_class_course_day_teacher.get(
                    key_day_teacher,
                    0,
                ) + 1
                existing_by_class_course_slot_teacher[key_slot_teacher] = existing_by_class_course_slot_teacher.get(
                    key_slot_teacher,
                    0,
                ) + 1

    course_relation_constraints_added = 0
    course_relation_existing_conflicts: list[dict[str, Any]] = []

    def relation_slot_expr(class_id: str, course_ids: set[str], slot: str, s_idx: int) -> cp_model.LinearExpr | int:
        existing = int(bool(lesson_course_ids(payload.scheduleMap.get(class_id, {}).get(slot)) & course_ids))
        indexes: set[tuple[int, int]] = set()
        for u_idx, unit in enumerate(units):
            if class_id not in unit["target_ids"] or (u_idx, s_idx) not in x:
                continue
            unit_course_ids = set(unit["course_ids_by_class"].get(class_id, []))
            if unit_course_ids & course_ids:
                indexes.add((u_idx, s_idx))
        if not indexes:
            return existing
        return existing + sum(x[index] for index in sorted(indexes))

    def relation_day_presence(
        class_id: str,
        course_ids: set[str],
        day: str,
        relation_idx: int,
        side: str,
    ) -> cp_model.IntVar | int:
        class_grid = payload.scheduleMap.get(class_id, {})
        if any(lesson_course_ids(class_grid.get(slot)) & course_ids for _, _, slot in slots_by_day.get(day, [])):
            return 1
        indexes: set[tuple[int, int]] = set()
        for _, s_idx, _ in slots_by_day.get(day, []):
            for u_idx, unit in enumerate(units):
                if class_id not in unit["target_ids"] or (u_idx, s_idx) not in x:
                    continue
                if set(unit["course_ids_by_class"].get(class_id, [])) & course_ids:
                    indexes.add((u_idx, s_idx))
        if not indexes:
            return 0
        active = model.NewBoolVar(f"course_relation_{relation_idx}_{class_id}_{day}_{side}")
        terms_local = [x[index] for index in sorted(indexes)]
        model.Add(sum(terms_local) >= 1).OnlyEnforceIf(active)
        model.Add(sum(terms_local) == 0).OnlyEnforceIf(active.Not())
        return active

    if enable_course_relation:
        for relation_idx, relation in enumerate(payload.courseRelationConstraints or []):
            class_id = str(relation.classId or "").strip()
            course_a_ids = {str(value or "").strip() for value in relation.courseAIds or [] if str(value or "").strip()}
            course_b_ids = {str(value or "").strip() for value in relation.courseBIds or [] if str(value or "").strip()}
            relation_type = str(relation.relationType or "").strip()
            if class_id not in class_set or not course_a_ids or not course_b_ids:
                continue
            if relation_type == "前后互斥":
                for day, day_slots in slots_by_day.items():
                    for slot_idx in range(len(day_slots) - 1):
                        period_a, s_idx_a, slot_a = day_slots[slot_idx]
                        period_b, s_idx_b, slot_b = day_slots[slot_idx + 1]
                        if period_b - period_a != 1:
                            continue
                        pairs = [
                            (
                                relation_slot_expr(class_id, course_a_ids, slot_a, s_idx_a),
                                relation_slot_expr(class_id, course_b_ids, slot_b, s_idx_b),
                            ),
                            (
                                relation_slot_expr(class_id, course_b_ids, slot_a, s_idx_a),
                                relation_slot_expr(class_id, course_a_ids, slot_b, s_idx_b),
                            ),
                        ]
                        for left, right in pairs:
                            if isinstance(left, int) and isinstance(right, int):
                                if left + right > 1:
                                    course_relation_existing_conflicts.append(
                                        {
                                            "classId": class_id,
                                            "relationType": relation_type,
                                            "day": day,
                                            "slots": [slot_a, slot_b],
                                            "courseAIds": sorted(course_a_ids),
                                            "courseBIds": sorted(course_b_ids),
                                        }
                                    )
                                continue
                            model.Add(left + right <= 1)
                            course_relation_constraints_added += 1
            elif relation_type == "同天互斥":
                for day in slots_by_day:
                    active_a = relation_day_presence(class_id, course_a_ids, day, relation_idx, "a")
                    active_b = relation_day_presence(class_id, course_b_ids, day, relation_idx, "b")
                    if isinstance(active_a, int) and isinstance(active_b, int):
                        if active_a + active_b > 1:
                            course_relation_existing_conflicts.append(
                                {
                                    "classId": class_id,
                                    "relationType": relation_type,
                                    "day": day,
                                    "courseAIds": sorted(course_a_ids),
                                    "courseBIds": sorted(course_b_ids),
                                }
                            )
                        continue
                    model.Add(active_a + active_b <= 1)
                    course_relation_constraints_added += 1

    if course_relation_existing_conflicts:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "COURSE_RELATION_EXISTING_CONFLICT",
                "message": "已排课表违反课程关系规则，请先调整后再智能排课。",
                "conflictCount": len(course_relation_existing_conflicts),
                "conflicts": course_relation_existing_conflicts[:10],
            },
        )
    push_log("规则", f"课程关系硬约束：新增 {course_relation_constraints_added} 条。")

    day_keys = sorted(slots_by_day.keys(), key=lambda d: day_order.get(d, 99))
    consecutive_constraints_raw = payload.consecutiveConstraints or []
    consecutive_constraints: list[dict[str, Any]] = []
    consecutive_required_courses: set[tuple[str, str]] = set()
    consecutive_day_candidates: dict[tuple[str, str], set[str]] = {}
    for item in consecutive_constraints_raw:
        class_id = str(item.classId or "").strip()
        if class_id not in class_set:
            continue
        course_ids = {str(course_id or "").strip() for course_id in (item.courseIds or []) if str(course_id or "").strip()}
        if not course_ids:
            continue
        weekly_count = max(0, min(5, int(item.weeklyConsecutiveCount or 0)))
        if weekly_count <= 0:
            continue
        preferred_days = [
            str(day or "").strip()
            for day in (item.preferredDays or [])
            if str(day or "").strip() in day_order
        ]
        for course_id in course_ids:
            consecutive_required_courses.add((class_id, course_id))
            if preferred_days:
                consecutive_day_candidates[(class_id, course_id)] = set(preferred_days)
            else:
                consecutive_day_candidates[(class_id, course_id)] = set(day_keys)
        consecutive_constraints.append(
            {
                "classId": class_id,
                "courseIds": course_ids,
                "weeklyConsecutiveCount": weekly_count,
                "preferredDays": list(dict.fromkeys(preferred_days)),
            }
        )

    def is_consecutive_day(class_id: str, course_key: str, day: str) -> bool:
        days = consecutive_day_candidates.get((class_id, course_key))
        if not days:
            return False
        return day in days

    course_default_objective_terms: list[cp_model.LinearExpr | int] = []

    def course_day_presence(
        class_id: str,
        course_key: str,
        day: str,
        *,
        teacher: str | None = None,
        name_prefix: str,
    ) -> cp_model.IntVar | int:
        if teacher:
            existing_count = existing_by_class_course_day_teacher.get((class_id, course_key, day, teacher), 0)
        else:
            existing_count = existing_by_class_course_day.get((class_id, course_key, day), 0)
        if existing_count > 0:
            return 1

        indexes: set[tuple[int, int]] = set()
        for _, s_idx, _ in slots_by_day.get(day, []):
            for u_idx, unit in enumerate(units):
                if unit["course_key_by_class"].get(class_id) != course_key:
                    continue
                if teacher and teacher not in unit["teachers"]:
                    continue
                if (u_idx, s_idx) in x:
                    indexes.add((u_idx, s_idx))
        if not indexes:
            return 0

        active = model.NewBoolVar(f"{name_prefix}_{class_id}_{course_key}_{teacher or 'all'}_{day}")
        active_terms = [x[index] for index in sorted(indexes)]
        model.Add(sum(active_terms) >= 1).OnlyEnforceIf(active)
        model.Add(sum(active_terms) == 0).OnlyEnforceIf(active.Not())
        return active

    def both_active_term(
        left: cp_model.LinearExpr | int,
        right: cp_model.LinearExpr | int,
        *,
        name: str,
    ) -> cp_model.LinearExpr | int:
        left_is_int = isinstance(left, int)
        right_is_int = isinstance(right, int)
        if left_is_int and right_is_int:
            return 1 if left == 1 and right == 1 else 0
        if left_is_int:
            return right if left == 1 else 0
        if right_is_int:
            return left if right == 1 else 0
        both = model.NewBoolVar(name)
        model.Add(both <= left)
        model.Add(both <= right)
        model.Add(both >= left + right - 1)
        return both

    sync_added_constraints = 0
    sync_pair_constraints = 0
    sync_alternating_constraints = 0
    if default_rules_enabled:
        course_to_classes: dict[tuple[str, str], set[str]] = {}
        for unit in units:
            for class_id, course_key in unit["course_key_by_class"].items():
                if not course_key:
                    continue
                if not rule_pair_has_value(
                    default_rules_raw.get("syncStart"),
                    course_key,
                    main_course_ids,
                    secondary_course_ids,
                    {"必须一致", "启用"},
                ):
                    continue
                for teacher in unit["teachers"]:
                    if not teacher:
                        continue
                    course_to_classes.setdefault((course_key, teacher), set()).add(class_id)
        # Include classes that only exist in current schedule (no remaining demand this round).
        for class_id, course_key, _day, teacher in existing_by_class_course_day_teacher.keys():
            if not course_key or not teacher:
                continue
            if not rule_pair_has_value(
                default_rules_raw.get("syncStart"),
                course_key,
                main_course_ids,
                secondary_course_ids,
                {"必须一致", "启用"},
            ):
                continue
            course_to_classes.setdefault((course_key, teacher), set()).add(class_id)

        existing_sync_day_count_conflicts: list[dict[str, Any]] = []

        for (course_key, teacher), class_group in course_to_classes.items():
            class_list = sorted(class_group)
            if len(class_list) < 2:
                continue
            for day in day_keys:
                for i in range(len(class_list)):
                    for j in range(i + 1, len(class_list)):
                        class_a = class_list[i]
                        class_b = class_list[j]
                        # 连堂并入教案齐头：仅在“连堂目标日”放宽同一天课时数一致；
                        # 其他天继续严格要求齐头。
                        if is_consecutive_day(class_a, course_key, day) or is_consecutive_day(class_b, course_key, day):
                            continue
                        vars_a: list[cp_model.IntVar] = []
                        vars_b: list[cp_model.IntVar] = []
                        for _, s_idx, _ in slots_by_day.get(day, []):
                            for u_idx, unit in enumerate(units):
                                unit_key_a = unit["course_key_by_class"].get(class_a)
                                unit_key_b = unit["course_key_by_class"].get(class_b)
                                if (
                                    unit_key_a == course_key
                                    and teacher in unit["teachers"]
                                    and (u_idx, s_idx) in x
                                ):
                                    vars_a.append(x[(u_idx, s_idx)])
                                if (
                                    unit_key_b == course_key
                                    and teacher in unit["teachers"]
                                    and (u_idx, s_idx) in x
                                ):
                                    vars_b.append(x[(u_idx, s_idx)])
                        existing_a = existing_by_class_course_day_teacher.get((class_a, course_key, day, teacher), 0)
                        existing_b = existing_by_class_course_day_teacher.get((class_b, course_key, day, teacher), 0)
                        if not vars_a and not vars_b:
                            if existing_a != existing_b:
                                existing_sync_day_count_conflicts.append(
                                    {
                                        "courseId": course_key,
                                        "teacher": teacher,
                                        "day": day,
                                        "classA": class_a,
                                        "countA": existing_a,
                                        "classB": class_b,
                                        "countB": existing_b,
                                    }
                                )
                            continue
                        model.Add(sum(vars_a) + existing_a == sum(vars_b) + existing_b)
                        sync_added_constraints += 1

        # 教案齐头补充：当两个班在某天均为“单节课”时，下一次同样条件出现需要先后对调。
        # 仅在单节课场景启用，以避免与连堂双节场景冲突。
        day_single_cache: dict[tuple[str, str, str, str], tuple[cp_model.IntVar | int, cp_model.LinearExpr | int]] = {}

        def single_day_info(class_id: str, course_key: str, teacher: str, day: str) -> tuple[cp_model.IntVar | int, cp_model.LinearExpr | int]:
            cache_key = (class_id, course_key, teacher, day)
            if cache_key in day_single_cache:
                return day_single_cache[cache_key]
            day_slots = slots_by_day.get(day, [])
            terms_by_slot: list[tuple[int, cp_model.LinearExpr | int]] = []
            for period, s_idx, slot in day_slots:
                vars_slot: list[cp_model.IntVar] = []
                for u_idx, unit in enumerate(units):
                    if (
                        unit["course_key_by_class"].get(class_id) == course_key
                        and teacher in unit["teachers"]
                        and (u_idx, s_idx) in x
                    ):
                        vars_slot.append(x[(u_idx, s_idx)])
                existing_slot = existing_by_class_course_slot_teacher.get((class_id, course_key, slot, teacher), 0)
                expr_slot: cp_model.LinearExpr | int = existing_slot + (sum(vars_slot) if vars_slot else 0)
                terms_by_slot.append((period, expr_slot))

            day_count_expr: cp_model.LinearExpr | int = sum(expr for _, expr in terms_by_slot) if terms_by_slot else 0
            weighted_expr: cp_model.LinearExpr | int = sum(period * expr for period, expr in terms_by_slot) if terms_by_slot else 0

            if isinstance(day_count_expr, int):
                single_day: cp_model.IntVar | int = 1 if day_count_expr == 1 else 0
            else:
                single_var = model.NewBoolVar(f"sync_single_{class_id}_{course_key}_{teacher}_{day}")
                model.Add(day_count_expr == 1).OnlyEnforceIf(single_var)
                model.Add(day_count_expr != 1).OnlyEnforceIf(single_var.Not())
                single_day = single_var
            day_single_cache[cache_key] = (single_day, weighted_expr)
            return single_day, weighted_expr

        for (course_key, teacher), class_group in course_to_classes.items():
            class_list = sorted(class_group)
            if len(class_list) < 2:
                continue
            for i in range(len(class_list)):
                for j in range(i + 1, len(class_list)):
                    class_a = class_list[i]
                    class_b = class_list[j]
                    day_order_vars: dict[str, cp_model.IntVar] = {}
                    day_active_vars: dict[str, cp_model.IntVar] = {}
                    for day in day_keys:
                        # 连堂目标日放宽齐头，不参与先后轮换。
                        if is_consecutive_day(class_a, course_key, day) or is_consecutive_day(class_b, course_key, day):
                            continue
                        single_a, pos_a = single_day_info(class_a, course_key, teacher, day)
                        single_b, pos_b = single_day_info(class_b, course_key, teacher, day)

                        if isinstance(single_a, int) and isinstance(single_b, int):
                            if single_a != 1 or single_b != 1:
                                continue
                            both_single: cp_model.IntVar | int = 1
                        else:
                            both_single_var = model.NewBoolVar(f"sync_both_single_{class_a}_{class_b}_{course_key}_{teacher}_{day}")
                            if isinstance(single_a, int):
                                if single_a == 1:
                                    model.Add(both_single_var <= single_b)  # type: ignore[arg-type]
                                    model.Add(both_single_var == single_b)  # type: ignore[arg-type]
                                else:
                                    model.Add(both_single_var == 0)
                            elif isinstance(single_b, int):
                                if single_b == 1:
                                    model.Add(both_single_var <= single_a)  # type: ignore[arg-type]
                                    model.Add(both_single_var == single_a)  # type: ignore[arg-type]
                                else:
                                    model.Add(both_single_var == 0)
                            else:
                                model.Add(both_single_var <= single_a)
                                model.Add(both_single_var <= single_b)
                                model.Add(both_single_var >= single_a + single_b - 1)
                            both_single = both_single_var

                        if isinstance(both_single, int) and both_single == 0:
                            continue

                        order_var = model.NewBoolVar(f"sync_order_{class_a}_{class_b}_{course_key}_{teacher}_{day}")
                        model.Add(pos_a + 1 <= pos_b).OnlyEnforceIf(order_var)
                        model.Add(pos_b + 1 <= pos_a).OnlyEnforceIf(order_var.Not())
                        if not (isinstance(both_single, int) and both_single == 1):
                            model.Add(order_var == 0).OnlyEnforceIf(both_single.Not())  # type: ignore[arg-type]
                        day_order_vars[day] = order_var
                        if isinstance(both_single, int):
                            active_const = model.NewBoolVar(f"sync_active_const_{class_a}_{class_b}_{course_key}_{teacher}_{day}")
                            model.Add(active_const == both_single)
                            day_active_vars[day] = active_const
                        else:
                            day_active_vars[day] = both_single

                    active_days = [day for day in day_keys if day in day_order_vars and day in day_active_vars]
                    for left_idx in range(len(active_days) - 1):
                        for right_idx in range(left_idx + 1, len(active_days)):
                            day_a = active_days[left_idx]
                            day_b = active_days[right_idx]
                            order_a = day_order_vars[day_a]
                            order_b = day_order_vars[day_b]
                            active_a = day_active_vars[day_a]
                            active_b = day_active_vars[day_b]
                            middle_days = active_days[left_idx + 1 : right_idx]
                            middle_active = [day_active_vars[day] for day in middle_days]
                            next_active_pair = model.NewBoolVar(
                                f"sync_alt_active_{class_a}_{class_b}_{course_key}_{teacher}_{day_a}_{day_b}"
                            )
                            model.Add(next_active_pair <= active_a)
                            model.Add(next_active_pair <= active_b)
                            for active_mid in middle_active:
                                model.Add(next_active_pair + active_mid <= 1)
                            model.Add(
                                next_active_pair
                                >= active_a + active_b - 1 - (sum(middle_active) if middle_active else 0)
                            )
                            model.Add(order_a + order_b == 1).OnlyEnforceIf(next_active_pair)
                            sync_alternating_constraints += 1

        # 教案齐头补充：同一天内同班同课程要么仅 1 节，要么 2 节且必须连排。
        # 实现方式：任意两个“非相邻节次”不能同时出现该课程。
        existing_conflicts: list[dict[str, Any]] = []
        for class_id in class_ids:
            course_teacher_keys = sorted(
                {
                    (
                        unit["course_key_by_class"].get(class_id, ""),
                        str(teacher or "").strip(),
                    )
                    for unit in units
                    for teacher in unit["teachers"]
                    if unit["course_key_by_class"].get(class_id, "") and str(teacher or "").strip()
                }
            )
            for course_key, teacher in course_teacher_keys:
                if not rule_pair_has_value(
                    default_rules_raw.get("syncStart"),
                    course_key,
                    main_course_ids,
                    secondary_course_ids,
                    {"必须一致", "启用"},
                ):
                    continue
                for day in day_keys:
                    slots = slots_by_day.get(day, [])
                    if len(slots) <= 1:
                        continue
                    for i in range(len(slots)):
                        period_i, s_idx_i, slot_i = slots[i]
                        existing_i = existing_by_class_course_slot_teacher.get((class_id, course_key, slot_i, teacher), 0)
                        vars_i: list[cp_model.IntVar] = []
                        for u_idx, unit in enumerate(units):
                            if (
                                unit["course_key_by_class"].get(class_id) == course_key
                                and teacher in unit["teachers"]
                                and (u_idx, s_idx_i) in x
                            ):
                                vars_i.append(x[(u_idx, s_idx_i)])
                        for j in range(i + 1, len(slots)):
                            period_j, s_idx_j, slot_j = slots[j]
                            if abs(period_j - period_i) <= 1:
                                continue
                            existing_j = existing_by_class_course_slot_teacher.get((class_id, course_key, slot_j, teacher), 0)
                            vars_j: list[cp_model.IntVar] = []
                            for u_idx, unit in enumerate(units):
                                if (
                                    unit["course_key_by_class"].get(class_id) == course_key
                                    and teacher in unit["teachers"]
                                    and (u_idx, s_idx_j) in x
                                ):
                                    vars_j.append(x[(u_idx, s_idx_j)])

                            # 严格模式：既有课表已违反“非相邻不可同日”时，直接返回失败并给出冲突明细。
                            if existing_i > 0 and existing_j > 0:
                                existing_conflicts.append(
                                    {
                                        "classId": class_id,
                                        "courseId": course_key,
                                        "teacher": teacher,
                                        "day": day,
                                        "periods": [period_i, period_j],
                                    }
                                )
                                continue

                            rhs = 1 - existing_i - existing_j
                            if rhs < 0:
                                rhs = 0
                            if vars_i or vars_j:
                                model.Add(sum(vars_i) + sum(vars_j) <= rhs)
                                sync_pair_constraints += 1
        if existing_sync_day_count_conflicts:
            preview = existing_sync_day_count_conflicts[:8]
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "SYNC_START_DAY_COUNT_CONFLICT",
                    "message": "已存在不符合“同一老师不同班级同一天课时数一致”规则的课表，请先调整后再智能排课。",
                    "conflictCount": len(existing_sync_day_count_conflicts),
                    "conflicts": preview,
                },
            )
        if existing_conflicts:
            preview = existing_conflicts[:8]
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "SYNC_START_EXISTING_CONFLICT",
                    "message": "已存在不符合“同日同课程需连排”规则的课表，请先调整后再智能排课。",
                    "conflictCount": len(existing_conflicts),
                    "conflicts": preview,
                },
            )
    push_log(
        "规则",
        f"教案齐头硬约束：新增 {sync_added_constraints} 条进度一致约束，新增 {sync_pair_constraints} 条同日连排约束"
        + f"，新增 {sync_alternating_constraints} 条先后对调约束。",
    )

    sync_preference_terms = 0
    sync_preference_weight = 50
    if default_rules_enabled:
        soft_course_to_classes: dict[tuple[str, str], set[str]] = {}
        for unit in units:
            for class_id, course_key in unit["course_key_by_class"].items():
                if not course_key or not rule_pair_has_value(
                    default_rules_raw.get("syncStart"),
                    course_key,
                    main_course_ids,
                    secondary_course_ids,
                    {"尽量一致"},
                ):
                    continue
                for teacher in unit["teachers"]:
                    if teacher:
                        soft_course_to_classes.setdefault((course_key, teacher), set()).add(class_id)
        for class_id, course_key, _day, teacher in existing_by_class_course_day_teacher.keys():
            if not course_key or not teacher or not rule_pair_has_value(
                default_rules_raw.get("syncStart"),
                course_key,
                main_course_ids,
                secondary_course_ids,
                {"尽量一致"},
            ):
                continue
            soft_course_to_classes.setdefault((course_key, teacher), set()).add(class_id)

        for (course_key, teacher), class_group in soft_course_to_classes.items():
            class_list = sorted(class_group)
            for left_index in range(len(class_list) - 1):
                for right_index in range(left_index + 1, len(class_list)):
                    class_a = class_list[left_index]
                    class_b = class_list[right_index]
                    for day in day_keys:
                        active_a = course_day_presence(
                            class_a,
                            course_key,
                            day,
                            teacher=teacher,
                            name_prefix="sync_pref_a",
                        )
                        active_b = course_day_presence(
                            class_b,
                            course_key,
                            day,
                            teacher=teacher,
                            name_prefix="sync_pref_b",
                        )
                        matched = both_active_term(
                            active_a,
                            active_b,
                            name=f"sync_pref_both_{class_a}_{class_b}_{course_key}_{teacher}_{day}",
                        )
                        if isinstance(matched, int):
                            if matched:
                                course_default_objective_terms.append(sync_preference_weight)
                                sync_preference_terms += 1
                        else:
                            course_default_objective_terms.append(sync_preference_weight * matched)
                            sync_preference_terms += 1
    push_log(
        "规则",
        f"教案齐头软偏好：加入 {sync_preference_terms} 个同日进度目标项（权重={sync_preference_weight}）。",
    )

    distribution_preference_terms = 0
    distribution_preference_weight = 60
    if default_rules_enabled:
        for class_id in class_ids:
            course_keys = sorted(
                {
                    unit["course_key_by_class"].get(class_id, "")
                    for unit in units
                    if unit["course_key_by_class"].get(class_id, "")
                }
            )
            for course_key in course_keys:
                preference = rule_pair_value(default_rules_raw.get("distribution"), course_key, main_course_ids, secondary_course_ids)
                if preference not in {
                    "尽量分散到不同天",
                    "尽量均匀分散到整周",
                    "尽量集中在较少天",
                    "尽量在一上午/一下午集中上完",
                    "优先安排在周中",
                    "优先排在周中时段",
                }:
                    continue
                for day in day_keys:
                    active = course_day_presence(
                        class_id,
                        course_key,
                        day,
                        name_prefix="course_week_pref",
                    )
                    multiplier = 0
                    if preference in {"尽量分散到不同天", "尽量均匀分散到整周"}:
                        multiplier = 1
                    elif preference in {"尽量集中在较少天", "尽量在一上午/一下午集中上完"}:
                        multiplier = -1
                    elif preference in {"优先安排在周中", "优先排在周中时段"} and day in {"周二", "周三", "周四"}:
                        multiplier = 1
                    if multiplier == 0:
                        continue
                    if isinstance(active, int):
                        if active:
                            course_default_objective_terms.append(multiplier * distribution_preference_weight)
                            distribution_preference_terms += 1
                    else:
                        course_default_objective_terms.append(multiplier * distribution_preference_weight * active)
                        distribution_preference_terms += 1
    push_log(
        "规则",
        f"课程周分布软偏好：加入 {distribution_preference_terms} 个目标项（权重={distribution_preference_weight}）。",
    )

    no_cross_noon_constraints = 0
    if default_rules_enabled and noon_boundary_by_class:
        for teacher in all_teachers:
            for day in day_keys:
                morning_indexes: set[tuple[int, int]] = set()
                afternoon_indexes: set[tuple[int, int]] = set()
                existing_morning = 0
                existing_afternoon = 0
                for class_id in class_ids:
                    boundary = noon_boundary_by_class.get(class_id) or {}
                    morning_end = int(boundary.get("morningEnd") or 0)
                    afternoon_start = int(boundary.get("afternoonStart") or 0)
                    if morning_end <= 0 or afternoon_start <= 0:
                        continue
                    morning_slot = f"{morning_end}-{day}"
                    afternoon_slot = f"{afternoon_start}-{day}"
                    for u_idx, unit in enumerate(units):
                        if teacher not in unit["teachers"]:
                            continue
                        course_key = unit["course_key_by_class"].get(class_id, "")
                        if not rule_pair_has_value(
                            default_rules_raw.get("noCrossNoon"),
                            course_key,
                            main_course_ids,
                            secondary_course_ids,
                            {"不能让老师在上午末节和下午首节连上", "禁止教师上午末节与下午首节连上"},
                        ):
                            continue
                        s_idx_m = slot_index_map.get(morning_slot, -1)
                        s_idx_a = slot_index_map.get(afternoon_slot, -1)
                        if s_idx_m >= 0 and (u_idx, s_idx_m) in x:
                            morning_indexes.add((u_idx, s_idx_m))
                        if s_idx_a >= 0 and (u_idx, s_idx_a) in x:
                            afternoon_indexes.add((u_idx, s_idx_a))
                    lesson_m = payload.scheduleMap.get(class_id, {}).get(morning_slot)
                    lesson_a = payload.scheduleMap.get(class_id, {}).get(afternoon_slot)
                    if teacher in lesson_teachers(lesson_m):
                        course_key = str((lesson_m.courseId if lesson_m else "") or "").strip()
                        if rule_pair_has_value(
                            default_rules_raw.get("noCrossNoon"),
                            course_key,
                            main_course_ids,
                            secondary_course_ids,
                            {"不能让老师在上午末节和下午首节连上", "禁止教师上午末节与下午首节连上"},
                        ):
                            existing_morning = 1
                    if teacher in lesson_teachers(lesson_a):
                        course_key = str((lesson_a.courseId if lesson_a else "") or "").strip()
                        if rule_pair_has_value(
                            default_rules_raw.get("noCrossNoon"),
                            course_key,
                            main_course_ids,
                            secondary_course_ids,
                            {"不能让老师在上午末节和下午首节连上", "禁止教师上午末节与下午首节连上"},
                        ):
                            existing_afternoon = 1
                if not morning_indexes and not afternoon_indexes:
                    continue
                rhs = 1 - existing_morning - existing_afternoon
                if rhs < 0:
                    rhs = 0
                model.Add(
                    sum(x[index] for index in sorted(morning_indexes))
                    + sum(x[index] for index in sorted(afternoon_indexes))
                    <= rhs
                )
                no_cross_noon_constraints += 1
    push_log("规则", f"上下节连续硬约束：新增 {no_cross_noon_constraints} 条。")

    no_consecutive_preference_terms = 0
    no_consecutive_preference_weight = 70
    if default_rules_enabled:
        for class_id in class_ids:
            course_keys = sorted(
                {
                    unit["course_key_by_class"].get(class_id, "")
                    for unit in units
                    if unit["course_key_by_class"].get(class_id, "")
                }
            )
            for course_key in course_keys:
                if (class_id, course_key) in consecutive_required_courses:
                    continue
                if not rule_pair_has_value(
                    default_rules_raw.get("sameClassNoConsecutive"),
                    course_key,
                    main_course_ids,
                    secondary_course_ids,
                    {"优先不连堂"},
                ):
                    continue
                for day, slots in slots_by_day.items():
                    for idx in range(len(slots) - 1):
                        period_a, s_idx_a, slot_a = slots[idx]
                        period_b, s_idx_b, slot_b = slots[idx + 1]
                        if period_b - period_a != 1:
                            continue
                        vars_a: list[cp_model.IntVar] = []
                        vars_b: list[cp_model.IntVar] = []
                        for u_idx, unit in enumerate(units):
                            if unit["course_key_by_class"].get(class_id) != course_key:
                                continue
                            if (u_idx, s_idx_a) in x:
                                vars_a.append(x[(u_idx, s_idx_a)])
                            if (u_idx, s_idx_b) in x:
                                vars_b.append(x[(u_idx, s_idx_b)])
                        existing_a = min(1, existing_by_class_course_slot.get((class_id, course_key, slot_a), 0))
                        existing_b = min(1, existing_by_class_course_slot.get((class_id, course_key, slot_b), 0))
                        active_a: cp_model.LinearExpr | int = existing_a + (sum(vars_a) if vars_a else 0)
                        active_b: cp_model.LinearExpr | int = existing_b + (sum(vars_b) if vars_b else 0)
                        pair_active = both_active_term(
                            active_a,
                            active_b,
                            name=f"avoid_consecutive_{class_id}_{course_key}_{day}_{period_a}_{period_b}",
                        )
                        if isinstance(pair_active, int):
                            if pair_active:
                                course_default_objective_terms.append(-no_consecutive_preference_weight)
                                no_consecutive_preference_terms += 1
                        else:
                            course_default_objective_terms.append(-no_consecutive_preference_weight * pair_active)
                            no_consecutive_preference_terms += 1
    push_log(
        "规则",
        f"同课程不连堂软偏好：加入 {no_consecutive_preference_terms} 个目标项（权重={no_consecutive_preference_weight}）。",
    )

    consecutive_hard_constraints = 0
    consecutive_daily_constraints = 0
    consecutive_preferred_terms = 0
    consecutive_conflicts: list[dict[str, Any]] = []
    consecutive_objective_terms: list[cp_model.LinearExpr | int] = []
    CONSECUTIVE_PREFERRED_WEIGHT = option_int(rule_options, "consecutivePreferredWeight", 30)
    CONSECUTIVE_PREFERRED_WEIGHT = max(0, min(1000, CONSECUTIVE_PREFERRED_WEIGHT))
    for constraint in consecutive_constraints:
        class_id = constraint["classId"]
        course_ids: set[str] = constraint["courseIds"]
        weekly_target = constraint["weeklyConsecutiveCount"]
        preferred_days = set(constraint["preferredDays"])
        class_grid = payload.scheduleMap.get(class_id, {})

        # Existing timetable already exceeds target consecutive-pair count.
        existing_pairs = 0
        existing_pairs_by_day: dict[str, int] = {}
        for day, slots in slots_by_day.items():
            for idx in range(len(slots) - 1):
                period_a, _, slot_a = slots[idx]
                period_b, _, slot_b = slots[idx + 1]
                if period_b - period_a != 1:
                    continue
                lesson_a = class_grid.get(slot_a)
                lesson_b = class_grid.get(slot_b)
                course_a = str((lesson_a.courseId if lesson_a else "") or (lesson_a.assignmentKey if lesson_a else "") or "").strip()
                course_b = str((lesson_b.courseId if lesson_b else "") or (lesson_b.assignmentKey if lesson_b else "") or "").strip()
                if course_a in course_ids and course_b in course_ids:
                    existing_pairs += 1
                    existing_pairs_by_day[day] = existing_pairs_by_day.get(day, 0) + 1
        overloaded_days = [day for day, count in existing_pairs_by_day.items() if count > 1]
        if overloaded_days:
            consecutive_conflicts.append(
                {
                    "classId": class_id,
                    "courseIds": sorted(course_ids),
                    "weeklyConsecutiveCount": weekly_target,
                    "existingPairs": existing_pairs,
                    "days": overloaded_days,
                    "reason": "multiple_pairs_same_day",
                }
            )
            continue
        if existing_pairs > weekly_target:
            consecutive_conflicts.append(
                {
                    "classId": class_id,
                    "courseIds": sorted(course_ids),
                    "weeklyConsecutiveCount": weekly_target,
                    "existingPairs": existing_pairs,
                    "reason": "existing_pairs_exceed_target",
                }
            )
            continue

        pair_terms: list[cp_model.LinearExpr | int] = []
        pair_terms_by_day: dict[str, list[cp_model.LinearExpr | int]] = {day: [] for day in day_keys}

        for day, slots in slots_by_day.items():
            if len(slots) <= 1:
                continue
            for idx in range(len(slots) - 1):
                period_a, s_idx_a, slot_a = slots[idx]
                period_b, s_idx_b, slot_b = slots[idx + 1]
                if period_b - period_a != 1:
                    continue

                vars_a: list[cp_model.IntVar] = []
                vars_b: list[cp_model.IntVar] = []
                for u_idx, unit in enumerate(units):
                    if class_id not in unit["target_ids"]:
                        continue
                    course_key = str(unit["course_id_by_class"].get(class_id, "")).strip()
                    if course_key not in course_ids:
                        continue
                    if (u_idx, s_idx_a) in x:
                        vars_a.append(x[(u_idx, s_idx_a)])
                    if (u_idx, s_idx_b) in x:
                        vars_b.append(x[(u_idx, s_idx_b)])

                lesson_a = class_grid.get(slot_a)
                lesson_b = class_grid.get(slot_b)
                existing_a = int(
                    str((lesson_a.courseId if lesson_a else "") or (lesson_a.assignmentKey if lesson_a else "") or "").strip()
                    in course_ids
                )
                existing_b = int(
                    str((lesson_b.courseId if lesson_b else "") or (lesson_b.assignmentKey if lesson_b else "") or "").strip()
                    in course_ids
                )

                expr_a: cp_model.LinearExpr | int = existing_a + sum(vars_a) if vars_a else existing_a
                expr_b: cp_model.LinearExpr | int = existing_b + sum(vars_b) if vars_b else existing_b

                term: cp_model.LinearExpr | int = 0
                expr_a_is_int = isinstance(expr_a, int)
                expr_b_is_int = isinstance(expr_b, int)
                if expr_a_is_int and expr_b_is_int:
                    term = 1 if (expr_a == 1 and expr_b == 1) else 0
                elif expr_a_is_int and expr_a == 1:
                    term = expr_b
                elif expr_b_is_int and expr_b == 1:
                    term = expr_a
                elif not expr_a_is_int and not expr_b_is_int:
                    pair_var = model.NewBoolVar(f"cons_pair_{class_id}_{day}_{period_a}_{period_b}")
                    model.Add(pair_var <= expr_a)
                    model.Add(pair_var <= expr_b)
                    model.Add(pair_var >= expr_a + expr_b - 1)
                    term = pair_var
                if isinstance(term, int) and term == 0:
                    continue
                pair_terms.append(term)
                pair_terms_by_day[day].append(term)

        if weekly_target > 0 and not pair_terms:
            consecutive_conflicts.append(
                {
                    "classId": class_id,
                    "courseIds": sorted(course_ids),
                    "weeklyConsecutiveCount": weekly_target,
                    "existingPairs": existing_pairs,
                    "reason": "no_pair_slots",
                }
            )
            continue

        pair_sum_expr: cp_model.LinearExpr | int = sum(pair_terms) if pair_terms else 0
        model.Add(pair_sum_expr == weekly_target)
        consecutive_hard_constraints += 1

        # Weekly consecutive count represents double-lesson days. A triple run
        # contains two overlapping adjacent pairs, so limiting each day to one
        # pair also prevents three consecutive lessons from being miscounted.
        for day, day_terms in pair_terms_by_day.items():
            if not day_terms:
                continue
            model.Add(sum(day_terms) <= 1)
            consecutive_daily_constraints += 1

        if preferred_days:
            for day in preferred_days:
                for term in pair_terms_by_day.get(day, []):
                    if CONSECUTIVE_PREFERRED_WEIGHT <= 0:
                        continue
                    if isinstance(term, int):
                        if term != 0:
                            consecutive_objective_terms.append(CONSECUTIVE_PREFERRED_WEIGHT * term)
                            consecutive_preferred_terms += 1
                    else:
                        consecutive_objective_terms.append(CONSECUTIVE_PREFERRED_WEIGHT * term)
                        consecutive_preferred_terms += 1

    if consecutive_conflicts:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "CONSECUTIVE_EXISTING_CONFLICT",
                "message": "连堂课硬约束无法满足，请放宽连堂设置或调整已排课。",
                "conflictCount": len(consecutive_conflicts),
                "conflicts": consecutive_conflicts[:10],
            },
        )

    push_log(
        "规则",
        f"连堂课约束：新增 {consecutive_hard_constraints} 条周次数硬约束，新增 {consecutive_daily_constraints} 条每日单组约束，"
        + f"新增 {consecutive_preferred_terms} 个优选日目标项（权重={CONSECUTIVE_PREFERRED_WEIGHT}）。",
    )

    two_gap_constraints = 0
    if default_rules_enabled:
        total_by_class_course: dict[tuple[str, str], int] = dict(existing_by_class_course_total)
        for unit in units:
            for class_id, course_key in unit["course_key_by_class"].items():
                if not class_id or not course_key:
                    continue
                total_by_class_course[(class_id, course_key)] = total_by_class_course.get((class_id, course_key), 0) + 1

        for (class_id, course_key), total in total_by_class_course.items():
            if total != 2:
                continue
            if not rule_pair_has_value(
                default_rules_raw.get("twoLessonsGap"),
                course_key,
                main_course_ids,
                secondary_course_ids,
                {"是", "启用"},
            ):
                continue
            day_exprs: dict[str, list[cp_model.IntVar]] = {day: [] for day in day_keys}
            existing_day: dict[str, int] = {day: existing_by_class_course_day.get((class_id, course_key, day), 0) for day in day_keys}
            for day, slots in slots_by_day.items():
                for _, s_idx, _ in slots:
                    for u_idx, unit in enumerate(units):
                        if unit["course_key_by_class"].get(class_id) == course_key and (u_idx, s_idx) in x:
                            day_exprs[day].append(x[(u_idx, s_idx)])
            for day in day_keys:
                if day_exprs[day]:
                    model.Add(sum(day_exprs[day]) + existing_day[day] <= 1)
                    two_gap_constraints += 1
            for idx in range(len(day_keys) - 1):
                day_a = day_keys[idx]
                day_b = day_keys[idx + 1]
                expr_a = sum(day_exprs[day_a]) + existing_day[day_a]
                expr_b = sum(day_exprs[day_b]) + existing_day[day_b]
                model.Add(expr_a + expr_b <= 1)
                two_gap_constraints += 1
    push_log("规则", f"2课时间隔一天硬约束：新增 {two_gap_constraints} 条。")

    default_morning_end_by_day: dict[str, int] = {}
    default_afternoon_start_by_day: dict[str, int] = {}
    for day, slots in slots_by_day.items():
        periods = [period for period, _, _ in slots]
        if not periods:
            continue
        midpoint_idx = (len(periods) - 1) // 2
        morning_end = periods[midpoint_idx]
        afternoon_start = periods[midpoint_idx + 1] if midpoint_idx + 1 < len(periods) else morning_end + 1
        default_morning_end_by_day[day] = morning_end
        default_afternoon_start_by_day[day] = afternoon_start

    def classify_half_day(class_id: str, day: str, period: int) -> str | None:
        boundary = noon_boundary_by_class.get(class_id) or {}
        morning_end = int(boundary.get("morningEnd") or 0)
        afternoon_start = int(boundary.get("afternoonStart") or 0)
        if morning_end <= 0 or afternoon_start <= 0 or afternoon_start <= morning_end:
            morning_end = int(default_morning_end_by_day.get(day, 0))
            afternoon_start = int(default_afternoon_start_by_day.get(day, 0))
        if morning_end <= 0 or afternoon_start <= 0:
            return None
        if period <= morning_end:
            return "morning"
        if period >= afternoon_start:
            return "afternoon"
        return None

    existing_teacher_slots_by_half: dict[tuple[str, str, str], set[str]] = {}
    for class_id in class_ids:
        grid = payload.scheduleMap.get(class_id, {})
        for slot in slot_keys:
            lesson = grid.get(slot)
            if lesson is None:
                continue
            meta = slot_meta.get(slot)
            if not meta:
                continue
            period, day = meta
            half = classify_half_day(class_id, day, period)
            if not half:
                continue
            for teacher in lesson_teachers(lesson):
                key = (teacher, day, half)
                existing_teacher_slots_by_half.setdefault(key, set()).add(slot)
    existing_teacher_occ_by_half = {
        key: len(slots) for key, slots in existing_teacher_slots_by_half.items()
    }

    teacher_day_pairs: dict[tuple[str, str], set[tuple[int, int]]] = {}
    teacher_day_half_pairs: dict[tuple[str, str, str], set[tuple[int, int]]] = {}
    for (u_idx, s_idx), _ in x.items():
        unit = units[u_idx]
        slot = slot_keys[s_idx]
        meta = slot_meta.get(slot)
        if not meta:
            continue
        period, day = meta
        teachers = unit["teachers"]
        target_ids = unit["target_ids"]
        for teacher in teachers:
            teacher_day_pairs.setdefault((teacher, day), set()).add((u_idx, s_idx))
            for class_id in target_ids:
                half = classify_half_day(class_id, day, period)
                if not half:
                    continue
                teacher_day_half_pairs.setdefault((teacher, day, half), set()).add((u_idx, s_idx))

    def make_presence_var(index_set: set[tuple[int, int]], name: str) -> cp_model.IntVar | None:
        if not index_set:
            return None
        terms_local = [x[idx] for idx in sorted(index_set)]
        if not terms_local:
            return None
        var = model.NewBoolVar(name)
        model.Add(sum(terms_local) >= 1).OnlyEnforceIf(var)
        model.Add(sum(terms_local) == 0).OnlyEnforceIf(var.Not())
        return var

    # Quality objective. Placement count is solved in a separate first stage below,
    # so soft preferences can never reduce the number of scheduled lessons.
    terms = []
    for (u_idx, s_idx), var in x.items():
        score = 1000 - s_idx
        terms.append(score * var)
    terms.extend(course_default_objective_terms)
    terms.extend(consecutive_objective_terms)

    WEEK_DISTRIBUTION_WEIGHT = week_distribution_weight
    DAY_DISTRIBUTION_WEIGHT = day_distribution_weight
    week_pref_terms = 0
    day_pref_terms = 0
    for teacher, conf in teacher_hour_constraints.items():
        week_pref = conf.get("weekDistribution")
        day_pref = conf.get("dayDistribution")
        if week_pref not in ("周分散", "周集中") and day_pref not in ("日分散", "日集中"):
            continue
        for day in day_keys:
            existing_day = 1 if existing_teacher_occ_by_day.get((teacher, day), 0) > 0 else 0
            existing_morning = 1 if existing_teacher_occ_by_half.get((teacher, day, "morning"), 0) > 0 else 0
            existing_afternoon = 1 if existing_teacher_occ_by_half.get((teacher, day, "afternoon"), 0) > 0 else 0

            day_presence_var = None if existing_day else make_presence_var(
                teacher_day_pairs.get((teacher, day), set()),
                f"pref_day_{teacher}_{day}",
            )
            morning_presence_var = None if existing_morning else make_presence_var(
                teacher_day_half_pairs.get((teacher, day, "morning"), set()),
                f"pref_morning_{teacher}_{day}",
            )
            afternoon_presence_var = None if existing_afternoon else make_presence_var(
                teacher_day_half_pairs.get((teacher, day, "afternoon"), set()),
                f"pref_afternoon_{teacher}_{day}",
            )

            day_active_expr: cp_model.LinearExpr | int = existing_day
            if day_active_expr == 0 and day_presence_var is not None:
                day_active_expr = day_presence_var

            if week_pref == "周分散":
                if WEEK_DISTRIBUTION_WEIGHT <= 0:
                    pass
                elif isinstance(day_active_expr, int):
                    if day_active_expr != 0:
                        terms.append(WEEK_DISTRIBUTION_WEIGHT)
                        week_pref_terms += 1
                else:
                    terms.append(WEEK_DISTRIBUTION_WEIGHT * day_active_expr)
                    week_pref_terms += 1
            if week_pref == "周集中":
                if WEEK_DISTRIBUTION_WEIGHT <= 0:
                    pass
                elif isinstance(day_active_expr, int):
                    if day_active_expr != 0:
                        terms.append(-WEEK_DISTRIBUTION_WEIGHT)
                        week_pref_terms += 1
                else:
                    terms.append(-WEEK_DISTRIBUTION_WEIGHT * day_active_expr)
                    week_pref_terms += 1

            morning_expr: cp_model.LinearExpr | int = existing_morning
            if morning_expr == 0 and morning_presence_var is not None:
                morning_expr = morning_presence_var
            afternoon_expr: cp_model.LinearExpr | int = existing_afternoon
            if afternoon_expr == 0 and afternoon_presence_var is not None:
                afternoon_expr = afternoon_presence_var

            both_expr: cp_model.LinearExpr | int = 0
            morning_is_int = isinstance(morning_expr, int)
            afternoon_is_int = isinstance(afternoon_expr, int)
            if morning_is_int and afternoon_is_int:
                both_expr = 1 if (morning_expr == 1 and afternoon_expr == 1) else 0
            elif morning_is_int and morning_expr == 1:
                both_expr = afternoon_expr
            elif afternoon_is_int and afternoon_expr == 1:
                both_expr = morning_expr
            elif not morning_is_int and not afternoon_is_int:
                both_var = model.NewBoolVar(f"pref_both_{teacher}_{day}")
                model.Add(both_var <= morning_expr)
                model.Add(both_var <= afternoon_expr)
                model.Add(both_var >= morning_expr + afternoon_expr - 1)
                both_expr = both_var

            if day_pref == "日分散":
                if DAY_DISTRIBUTION_WEIGHT <= 0:
                    pass
                elif isinstance(both_expr, int):
                    if both_expr != 0:
                        terms.append(DAY_DISTRIBUTION_WEIGHT)
                        day_pref_terms += 1
                else:
                    terms.append(DAY_DISTRIBUTION_WEIGHT * both_expr)
                    day_pref_terms += 1
            if day_pref == "日集中":
                if DAY_DISTRIBUTION_WEIGHT <= 0:
                    pass
                elif isinstance(both_expr, int):
                    if both_expr != 0:
                        terms.append(-DAY_DISTRIBUTION_WEIGHT)
                        day_pref_terms += 1
                else:
                    terms.append(-DAY_DISTRIBUTION_WEIGHT * both_expr)
                    day_pref_terms += 1
    push_log(
        "规则",
        f"教师周分布/日分布软约束：加入 {week_pref_terms + day_pref_terms} 个目标项（周权重={WEEK_DISTRIBUTION_WEIGHT}, 日权重={DAY_DISTRIBUTION_WEIGHT}）。",
    )

    placement_vars = list(x.values())
    total_time_limit = 8.0

    def configure_solver(target: cp_model.CpSolver, time_limit: float) -> None:
        target.parameters.max_time_in_seconds = max(0.1, time_limit)
        target.parameters.num_search_workers = 8
        target.parameters.random_seed = 20260715

    solve_started_at = perf_counter()
    model.Maximize(sum(placement_vars) if placement_vars else 0)
    primary_solver = cp_model.CpSolver()
    configure_solver(primary_solver, total_time_limit * 0.7)
    primary_status = primary_solver.Solve(model)
    if primary_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        status_name = primary_solver.StatusName(primary_status)
        raise HTTPException(
            status_code=422,
            detail={
                "code": "ORTOOLS_INFEASIBLE",
                "message": "当前硬约束下没有可行排课结果。" if primary_status == cp_model.INFEASIBLE else "求解器未能在限定时间内找到可行结果。",
                "solverStatus": status_name,
                "unitCount": len(units),
                "variableCount": len(x),
            },
        )

    best_placed_units = sum(primary_solver.Value(var) for var in placement_vars)
    push_log(
        "求解",
        f"第一阶段完成：优先保证排课数量，最多可安排 {best_placed_units}/{len(units)} 个需求单元（状态={primary_solver.StatusName(primary_status)}）。",
    )

    solver = primary_solver
    status = primary_status
    elapsed = perf_counter() - solve_started_at
    remaining_time = max(0.0, total_time_limit - elapsed)
    if placement_vars and terms and remaining_time >= 0.2:
        model.Add(sum(placement_vars) == best_placed_units)
        model.Maximize(sum(terms))
        quality_solver = cp_model.CpSolver()
        configure_solver(quality_solver, remaining_time)
        quality_status = quality_solver.Solve(model)
        if quality_status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            solver = quality_solver
            status = quality_status
            push_log(
                "求解",
                f"第二阶段完成：在不减少排课数量的前提下优化分布与时段偏好（状态={quality_solver.StatusName(quality_status)}）。",
            )
        else:
            push_log("求解", "第二阶段未取得更优可行解，保留第一阶段的最大排课数量结果。")

    placements = []
    placed_units = 0
    picked_slots_by_unit: dict[int, str] = {}
    for u_idx, unit in enumerate(units):
        picked_slot = None
        for s_idx, slot in enumerate(slot_keys):
            var = x.get((u_idx, s_idx))
            if var is None:
                continue
            if solver.Value(var) == 1:
                picked_slot = slot
                break
        if picked_slot is None:
            continue
        placed_units += 1
        picked_slots_by_unit[u_idx] = picked_slot
        demand: SolveDemand = unit["demand"]
        target_ids: list[str] = unit["target_ids"]
        is_combined = len(target_ids) > 1
        for class_id in target_ids:
            source = demand.lessonsByClass.get(class_id) or next(iter(demand.lessonsByClass.values()), None)
            if source is None:
                continue
            lesson = source.model_copy(deep=True)
            lesson.isCombined = is_combined
            lesson.locked = False
            placements.append({"classId": class_id, "slotKey": picked_slot, "lesson": lesson.model_dump()})

    # Diagnose why units remain unplaced.
    unplaced_by_reason: dict[str, dict[str, Any]] = {}
    final_class_slot_occ: dict[tuple[str, str], int] = {}
    final_teacher_slot_occ: dict[tuple[str, str], int] = {}
    for class_id in class_ids:
        for slot in slot_keys:
            if payload.scheduleMap.get(class_id, {}).get(slot) is not None:
                final_class_slot_occ[(class_id, slot)] = 1
                for teacher in lesson_teachers(payload.scheduleMap.get(class_id, {}).get(slot)):
                    final_teacher_slot_occ[(teacher, slot)] = final_teacher_slot_occ.get((teacher, slot), 0) + 1
    for u_idx, picked_slot in picked_slots_by_unit.items():
        unit = units[u_idx]
        for class_id in unit["target_ids"]:
            final_class_slot_occ[(class_id, picked_slot)] = 1
        for teacher in unit["teachers"]:
            final_teacher_slot_occ[(teacher, picked_slot)] = final_teacher_slot_occ.get((teacher, picked_slot), 0) + 1

    for u_idx, unit in enumerate(units):
        if u_idx in picked_slots_by_unit:
            continue
        demand: SolveDemand = unit["demand"]
        demand_key = str(demand.assignmentKey or unit.get("display_course") or f"unit-{u_idx}")
        row = unplaced_by_reason.get(demand_key)
        if row is None:
            row = {
                "course": str(unit.get("display_course") or demand_key),
                "targetClasses": sorted(unit["target_ids"]),
                "teachers": sorted(unit["teachers"]),
                "unplaced": 0,
                "noInitialSlots": 0,
                "initialFixed": 0,
                "initialClassOccupied": 0,
                "initialForbidden": 0,
                "initialTeacherOccupied": 0,
                "finalClassConflict": 0,
                "finalTeacherConflict": 0,
                "otherHardConstraints": 0,
            }
            unplaced_by_reason[demand_key] = row
        row["unplaced"] += 1

        allowed_slots = unit["allowed_slots"] or []
        if not allowed_slots:
            row["noInitialSlots"] += 1
            blockers = unit.get("build_blockers") or {}
            row["initialFixed"] += int(blockers.get("fixed", 0))
            row["initialClassOccupied"] += int(blockers.get("classOccupied", 0))
            row["initialForbidden"] += int(blockers.get("forbidden", 0))
            row["initialTeacherOccupied"] += int(blockers.get("teacherOccupied", 0))
            continue

        class_block = 0
        teacher_block = 0
        free_candidate = 0
        for slot in allowed_slots:
            if any(final_class_slot_occ.get((class_id, slot), 0) > 0 for class_id in unit["target_ids"]):
                class_block += 1
                continue
            if any(final_teacher_slot_occ.get((teacher, slot), 0) > 0 for teacher in unit["teachers"]):
                teacher_block += 1
                continue
            free_candidate += 1
        row["finalClassConflict"] += class_block
        row["finalTeacherConflict"] += teacher_block
        if free_candidate > 0:
            row["otherHardConstraints"] += free_candidate

    push_log(
        "诊断",
        f"诊断模块已启用：未排需求分组 {len(unplaced_by_reason)} 条，待排单元 {max(0, len(units) - placed_units)} 个。",
    )
    if unplaced_by_reason:
        top_rows = sorted(unplaced_by_reason.values(), key=lambda item: int(item.get("unplaced", 0)), reverse=True)[:8]
        for row in top_rows:
            push_log(
                "诊断",
                "未排课"
                + f" 课程={row['course']}"
                + f" 数量={row['unplaced']}"
                + f" 初始无槽位={row['noInitialSlots']}"
                + f" 初始阻塞[固定点={row['initialFixed']}, 班级占用={row['initialClassOccupied']}, 禁排={row['initialForbidden']}, 教师占用={row['initialTeacherOccupied']}]"
                + f" 终态阻塞[班级冲突={row['finalClassConflict']}, 教师冲突={row['finalTeacherConflict']}, 其他硬约束={row['otherHardConstraints']}]",
            )

    # Consecutive rule hit-rate summary on final timetable (existing + new placements).
    if consecutive_constraints:
        final_new_course_by_class_slot: dict[tuple[str, str], str] = {}
        for u_idx, picked_slot in picked_slots_by_unit.items():
            unit = units[u_idx]
            for class_id in unit["target_ids"]:
                course_key = str(unit["course_id_by_class"].get(class_id, "")).strip()
                if not class_id or not picked_slot or not course_key:
                    continue
                final_new_course_by_class_slot[(class_id, picked_slot)] = course_key

        def final_course_key(class_id: str, slot: str) -> str:
            new_key = final_new_course_by_class_slot.get((class_id, slot), "")
            if new_key:
                return new_key
            lesson = payload.scheduleMap.get(class_id, {}).get(slot)
            if lesson is None:
                return ""
            return str((lesson.courseId or lesson.assignmentKey or "")).strip()

        target_total = 0
        achieved_total = 0
        detail_rows: list[str] = []
        for constraint in consecutive_constraints:
            class_id = constraint["classId"]
            course_ids: set[str] = constraint["courseIds"]
            weekly_target = int(constraint["weeklyConsecutiveCount"] or 0)
            if weekly_target <= 0:
                continue
            actual_pairs = 0
            for _day, slots in slots_by_day.items():
                for idx in range(len(slots) - 1):
                    period_a, _, slot_a = slots[idx]
                    period_b, _, slot_b = slots[idx + 1]
                    if period_b - period_a != 1:
                        continue
                    course_a = final_course_key(class_id, slot_a)
                    course_b = final_course_key(class_id, slot_b)
                    if course_a in course_ids and course_b in course_ids:
                        actual_pairs += 1
            achieved = min(actual_pairs, weekly_target)
            target_total += weekly_target
            achieved_total += achieved
            if achieved < weekly_target:
                detail_rows.append(f"{class_id}: {achieved}/{weekly_target}")

        if target_total > 0:
            hit_rate = (achieved_total / target_total) * 100.0
            push_log(
                "规则",
                f"连堂课命中率：{achieved_total}/{target_total}（{hit_rate:.1f}%）。",
            )
            if detail_rows:
                preview = "；".join(detail_rows[:8])
                push_log("规则", f"连堂未达标班级：{preview}")

    # Post-check for sync-start strictness on final schedule:
    # 1) same teacher+course across related classes must have equal day counts
    # 2) if a class has >1 on a day, it must be exactly 2 and consecutive periods
    sync_count_conflicts: list[dict[str, Any]] = []
    sync_consecutive_conflicts: list[dict[str, Any]] = []
    if default_rules_enabled:
        teacher_course_classes: dict[tuple[str, str], set[str]] = {}
        final_day_count: dict[tuple[str, str, str, str], int] = {}
        final_day_periods: dict[tuple[str, str, str, str], list[int]] = {}

        def push_final(teacher: str, course_key: str, class_id: str, day: str, period: int) -> None:
            if not teacher or not course_key or not class_id or not day:
                return
            key = (teacher, course_key)
            teacher_course_classes.setdefault(key, set()).add(class_id)
            day_key = (teacher, course_key, class_id, day)
            final_day_count[day_key] = final_day_count.get(day_key, 0) + 1
            final_day_periods.setdefault(day_key, []).append(period)

        for class_id in class_ids:
            grid = payload.scheduleMap.get(class_id, {})
            for slot in slot_keys:
                lesson = grid.get(slot)
                if lesson is None:
                    continue
                meta = slot_meta.get(slot)
                if not meta:
                    continue
                period, day = meta
                course_key = str(lesson.courseId or lesson.assignmentKey or "").strip()
                if not course_key:
                    continue
                if not rule_pair_has_value(
                    default_rules_raw.get("syncStart"),
                    course_key,
                    main_course_ids,
                    secondary_course_ids,
                    {"必须一致", "启用"},
                ):
                    continue
                for teacher in lesson_teachers(lesson):
                    push_final(teacher, course_key, class_id, day, period)

        for u_idx, picked_slot in picked_slots_by_unit.items():
            unit = units[u_idx]
            meta = slot_meta.get(picked_slot)
            if not meta:
                continue
            period, day = meta
            for class_id in unit["target_ids"]:
                course_key = str(unit["course_key_by_class"].get(class_id, "")).strip()
                if not course_key:
                    continue
                if not rule_pair_has_value(
                    default_rules_raw.get("syncStart"),
                    course_key,
                    main_course_ids,
                    secondary_course_ids,
                    {"必须一致", "启用"},
                ):
                    continue
                for teacher in unit["teachers"]:
                    push_final(teacher, course_key, class_id, day, period)

        for (teacher, course_key), class_set in teacher_course_classes.items():
            if len(class_set) < 2:
                continue
            sorted_classes = sorted(class_set)
            for day in day_keys:
                if any(is_consecutive_day(class_id, course_key, day) for class_id in sorted_classes):
                    continue
                counts = [(class_id, final_day_count.get((teacher, course_key, class_id, day), 0)) for class_id in sorted_classes]
                if not counts:
                    continue
                target = counts[0][1]
                mismatch = next((item for item in counts[1:] if item[1] != target), None)
                if mismatch:
                    sync_count_conflicts.append(
                        {
                            "teacher": teacher,
                            "courseId": course_key,
                            "day": day,
                            "counts": counts,
                        }
                    )
                    if len(sync_count_conflicts) >= 8:
                        break
            if len(sync_count_conflicts) >= 8:
                break

        for day_key, count in final_day_count.items():
            if count <= 1:
                continue
            teacher, course_key, class_id, day = day_key
            periods = sorted(final_day_periods.get(day_key, []))
            # Strict interpretation: >1 means exactly two lessons and adjacent.
            if count != 2 or len(periods) != 2 or periods[1] - periods[0] != 1:
                sync_consecutive_conflicts.append(
                    {
                        "teacher": teacher,
                        "courseId": course_key,
                        "classId": class_id,
                        "day": day,
                        "periods": periods,
                    }
                )
                if len(sync_consecutive_conflicts) >= 8:
                    break

    if sync_count_conflicts:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "SYNC_START_POSTCHECK_DAY_COUNT",
                "message": "求解结果不符合“同一老师不同班级同一天课时数一致”规则。",
                "conflictCount": len(sync_count_conflicts),
                "conflicts": sync_count_conflicts,
            },
        )
    if sync_consecutive_conflicts:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "SYNC_START_POSTCHECK_CONSECUTIVE",
                "message": "求解结果不符合“同日多节需连续两节”规则。",
                "conflictCount": len(sync_consecutive_conflicts),
                "conflicts": sync_consecutive_conflicts,
            },
        )

    total_lesson_cells = sum(len(unit["target_ids"]) for unit in units)
    remaining = max(0, total_lesson_cells - len(placements))

    return {
        "ok": True,
        "result": {
            "placements": placements,
            "placedCount": len(placements),
            "remainingCount": remaining,
        },
        "logs": logs,
    }
