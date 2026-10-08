"""
GodView backend - free-tier Flask app.
Only job: receive Excel uploads (schools/drivers/buses/routes) and write them
into Firestore, using the Firebase Admin SDK.

Run locally:
    pip install -r requirements.txt
    export GOOGLE_APPLICATION_CREDENTIALS="serviceAccountKey.json"
    python app.py

Deploy free:
    Render.com -> New Web Service -> connect this repo/folder
    Build command: pip install -r requirements.txt
    Start command: gunicorn app:app
    Add serviceAccountKey.json contents as an env var or secret file (see README).
"""

import os
import io
import json
from collections import defaultdict

import pandas as pd
from flask import Flask, request, jsonify
from flask_cors import CORS
import firebase_admin
from firebase_admin import credentials, firestore

app = Flask(__name__)
CORS(app)  # allow the React frontend (any origin) to call this API

# ---- Firebase Admin init ----
# Option A (local dev): put serviceAccountKey.json in this folder and set
#   GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json
# Option B (Render free deploy): paste the JSON contents into an env var
#   called FIREBASE_SERVICE_ACCOUNT_JSON instead of a file.
if not firebase_admin._apps:
    json_env = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
    if json_env:
        cred = credentials.Certificate(json.loads(json_env))
    else:
        cred = credentials.Certificate(
            os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "serviceAccountKey.json")
        )
    firebase_admin.initialize_app(cred)

db = firestore.client()


def read_excel_from_request():
    if "file" not in request.files:
        raise ValueError("No file uploaded. Send it as form field 'file'.")
    f = request.files["file"]
    return pd.read_excel(io.BytesIO(f.read()))


def cell_str(row, col):
    val = row.get(col, "")
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return ""
    return str(val).strip()


def fetch_ids(collection):
    return {doc.id for doc in db.collection(collection).stream()}


def _max_id_num(collection, prefix):
    max_num = 0
    for doc_id in fetch_ids(collection):
        if doc_id.startswith(prefix) and doc_id[len(prefix):].isdigit():
            max_num = max(max_num, int(doc_id[len(prefix):]))
    return max_num


def next_id(collection, prefix, width=3):
    # Auto-generate the next sequential ID (e.g. SCH004) so manual-entry
    # forms never ask a person to type/invent one themselves.
    return f"{prefix}{str(_max_id_num(collection, prefix) + 1).zfill(width)}"


def next_ids(collection, prefix, count, width=3):
    # Same as next_id, but hands back `count` sequential new IDs in one go
    # (for bulk Excel uploads, where every row needs its own generated ID).
    start = _max_id_num(collection, prefix) + 1
    return [f"{prefix}{str(start + i).zfill(width)}" for i in range(count)]


def route_doc_id(school_id, route_id):
    # route_id only needs to be unique per school (e.g. every school can
    # have its own "RT001"), so the Firestore doc key is namespaced by
    # school to avoid one school's route silently overwriting another's.
    return f"{school_id}__{route_id}"


def class_section_key(class_, section):
    return f"{class_}_{section}"


def attendance_doc_id(school_id, class_, section, date):
    return f"{school_id}__{class_section_key(class_, section)}__{date}"


def timetable_doc_id(school_id, class_, section):
    return f"{school_id}__{class_section_key(class_, section)}"


def staff_attendance_doc_id(school_id, date):
    return f"{school_id}__{date}"


ID_LOOKUP_COLLECTIONS = {"schools", "drivers", "buses", "students", "exams", "employees"}


@app.route("/ids/<collection>", methods=["GET"])
def list_ids(collection):
    if collection not in ID_LOOKUP_COLLECTIONS:
        return jsonify({"error": "Unknown collection"}), 404
    return jsonify({"ids": sorted(fetch_ids(collection))})


MANAGED_COLLECTIONS = {
    "schools", "drivers", "buses", "routes",
    "students", "exams", "attendance", "timetable", "results",
    "admissions", "employees", "staffAttendance", "leaves",
    "feeStructure", "feePayments", "visitors", "enquiries", "gatePasses",
}


@app.route("/records/<collection>", methods=["GET"])
def list_records(collection):
    """Full documents (not just IDs) for the 'existing data' table in the
    Upload Data UI, so people can see and delete what's already there."""
    if collection not in MANAGED_COLLECTIONS:
        return jsonify({"error": "Unknown collection"}), 404
    docs = db.collection(collection).stream()
    items = [{"id": d.id, **d.to_dict()} for d in docs]
    return jsonify({"items": items})


@app.route("/records/<collection>/<doc_id>", methods=["DELETE"])
def delete_record(collection, doc_id):
    if collection not in MANAGED_COLLECTIONS:
        return jsonify({"error": "Unknown collection"}), 404
    db.collection(collection).document(doc_id).delete()
    return jsonify({"ok": True})


@app.route("/upload/schools", methods=["POST"])
def upload_schools():
    try:
        df = read_excel_from_request()
        required = {"name", "lat", "lng"}
        missing = required - set(df.columns)
        if missing:
            return jsonify({"error": f"Missing columns: {sorted(missing)}"}), 400

        errors = []
        for i, row in df.iterrows():
            excel_row = i + 2
            if not cell_str(row, "name"):
                errors.append(f"Row {excel_row}: name is required.")
            try:
                float(row["lat"])
                float(row["lng"])
            except (TypeError, ValueError):
                errors.append(f"Row {excel_row}: lat/lng must be numeric.")
        if errors:
            return jsonify({"error": "Validation failed", "details": errors}), 400

        ids = next_ids("schools", "SCH", len(df))
        batch = db.batch()
        count = 0
        for doc_id, (_, row) in zip(ids, df.iterrows()):
            ref = db.collection("schools").document(doc_id)
            batch.set(ref, {
                "name": row["name"],
                "lat": float(row["lat"]),
                "lng": float(row["lng"]),
            })
            count += 1
        batch.commit()
        return jsonify({"count": count})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/schools/add", methods=["POST"])
def add_school():
    """Create/update a single school from JSON, for the manual-entry form
    (as opposed to /upload/schools which takes a bulk Excel file)."""
    try:
        body = request.get_json(silent=True) or {}
        name = str(body.get("name", "")).strip()

        errors = []
        if not name:
            errors.append("name is required.")
        try:
            lat = float(body["lat"])
            lng = float(body["lng"])
        except (TypeError, ValueError, KeyError):
            errors.append("lat/lng must be numeric.")
            lat = lng = None
        if errors:
            return jsonify({"error": "Validation failed", "details": errors}), 400

        school_id = next_id("schools", "SCH")
        db.collection("schools").document(school_id).set({
            "name": name,
            "lat": lat,
            "lng": lng,
        })
        return jsonify({"count": 1, "id": school_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/upload/drivers", methods=["POST"])
def upload_drivers():
    try:
        df = read_excel_from_request()
        required = {"name"}
        missing = required - set(df.columns)
        if missing:
            return jsonify({"error": f"Missing columns: {sorted(missing)}"}), 400

        errors = []
        for i, row in df.iterrows():
            excel_row = i + 2
            if not cell_str(row, "name"):
                errors.append(f"Row {excel_row}: name is required.")
        if errors:
            return jsonify({"error": "Validation failed", "details": errors}), 400

        ids = next_ids("drivers", "DRV", len(df))
        batch = db.batch()
        count = 0
        for doc_id, (_, row) in zip(ids, df.iterrows()):
            ref = db.collection("drivers").document(doc_id)
            batch.set(ref, {
                "name": row["name"],
                "phone": str(row.get("phone", "")),
            })
            count += 1
        batch.commit()
        return jsonify({"count": count})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/drivers/add", methods=["POST"])
def add_driver():
    """Create/update a single driver from JSON, for the manual-entry form
    (as opposed to /upload/drivers which takes a bulk Excel file)."""
    try:
        body = request.get_json(silent=True) or {}
        name = str(body.get("name", "")).strip()
        phone = str(body.get("phone", "")).strip()

        errors = []
        if not name:
            errors.append("name is required.")
        if errors:
            return jsonify({"error": "Validation failed", "details": errors}), 400

        driver_id = next_id("drivers", "DRV")
        db.collection("drivers").document(driver_id).set({
            "name": name,
            "phone": phone,
        })
        return jsonify({"count": 1, "id": driver_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/upload/buses", methods=["POST"])
def upload_buses():
    try:
        df = read_excel_from_request()
        required = {"bus_number"}
        missing = required - set(df.columns)
        if missing:
            return jsonify({"error": f"Missing columns: {sorted(missing)}"}), 400

        existing_drivers = fetch_ids("drivers")
        errors = []
        for i, row in df.iterrows():
            excel_row = i + 2
            if not cell_str(row, "bus_number"):
                errors.append(f"Row {excel_row}: bus_number is required.")
            driver_id = cell_str(row, "driver_id")
            if driver_id and driver_id not in existing_drivers:
                errors.append(
                    f"Row {excel_row}: driver_id '{driver_id}' not found. Upload Drivers first."
                )
            cap = row.get("capacity")
            if cap is not None and not pd.isna(cap):
                try:
                    int(cap)
                except (TypeError, ValueError):
                    errors.append(f"Row {excel_row}: capacity must be a whole number.")
        if errors:
            return jsonify({"error": "Validation failed", "details": errors}), 400

        ids = next_ids("buses", "BUS", len(df))
        batch = db.batch()
        count = 0
        for doc_id, (_, row) in zip(ids, df.iterrows()):
            ref = db.collection("buses").document(doc_id)
            batch.set(ref, {
                "busNumber": str(row["bus_number"]),
                "driverId": str(row.get("driver_id", "")),
                "capacity": int(row["capacity"]) if not pd.isna(row.get("capacity")) else None,
            })
            count += 1
        batch.commit()
        return jsonify({"count": count})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/buses/add", methods=["POST"])
def add_bus():
    """Create/update a single bus from JSON, for the manual-entry form
    (as opposed to /upload/buses which takes a bulk Excel file)."""
    try:
        body = request.get_json(silent=True) or {}
        bus_number = str(body.get("bus_number", "")).strip()
        driver_id = str(body.get("driver_id", "")).strip()
        capacity_raw = body.get("capacity")

        errors = []
        if not bus_number:
            errors.append("bus_number is required.")
        if driver_id and driver_id not in fetch_ids("drivers"):
            errors.append(f"driver_id '{driver_id}' not found. Add the driver first.")
        capacity = None
        if capacity_raw not in (None, ""):
            try:
                capacity = int(capacity_raw)
            except (TypeError, ValueError):
                errors.append("capacity must be a whole number.")
        if errors:
            return jsonify({"error": "Validation failed", "details": errors}), 400

        bus_id = next_id("buses", "BUS")
        db.collection("buses").document(bus_id).set({
            "busNumber": bus_number,
            "driverId": driver_id,
            "capacity": capacity,
        })
        return jsonify({"count": 1, "id": bus_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/upload/routes", methods=["POST"])
def upload_routes():
    """
    Expects one row per stop. Rows sharing the same route_id are grouped
    into a single route document with a 'stops' array.

    Columns: route_id, school_id, bus_id, stop_order, stop_name, lat, lng, students_count
    """
    try:
        df = read_excel_from_request()
        required = {
            "route_id", "school_id", "bus_id",
            "stop_order", "stop_name", "lat", "lng", "students_count",
        }
        missing = required - set(df.columns)
        if missing:
            return jsonify({"error": f"Missing columns: {sorted(missing)}"}), 400

        existing_schools = fetch_ids("schools")
        existing_buses = fetch_ids("buses")
        errors = []
        seen_stops = set()
        # route_id only needs to be unique within a school, so group by
        # (school_id, route_id), not route_id alone.
        groups = defaultdict(list)
        for i, row in df.iterrows():
            excel_row = i + 2
            route_id = cell_str(row, "route_id")
            school_id = cell_str(row, "school_id")
            if not route_id:
                errors.append(f"Row {excel_row}: route_id is required.")
                continue
            if school_id not in existing_schools:
                errors.append(
                    f"Row {excel_row}: school_id '{school_id}' not found. Upload Schools first."
                )
            bus_id = cell_str(row, "bus_id")
            if bus_id not in existing_buses:
                errors.append(
                    f"Row {excel_row}: bus_id '{bus_id}' not found. Upload Buses first."
                )
            try:
                stop_order = int(row["stop_order"])
                key = (school_id, route_id, stop_order)
                if key in seen_stops:
                    errors.append(
                        f"Row {excel_row}: duplicate stop_order {stop_order} for route "
                        f"'{route_id}' at school '{school_id}'."
                    )
                seen_stops.add(key)
            except (TypeError, ValueError):
                errors.append(f"Row {excel_row}: stop_order must be a whole number.")
            try:
                float(row["lat"])
                float(row["lng"])
            except (TypeError, ValueError):
                errors.append(f"Row {excel_row}: lat/lng must be numeric.")
            try:
                int(row["students_count"])
            except (TypeError, ValueError):
                errors.append(f"Row {excel_row}: students_count must be a whole number.")
            groups[(school_id, route_id)].append(row)

        for (school_id, route_id), rows in groups.items():
            if len({cell_str(r, "bus_id") for r in rows}) > 1:
                errors.append(
                    f"Route '{route_id}' at school '{school_id}': all stops must share the same bus_id."
                )

        if errors:
            return jsonify({"error": "Validation failed", "details": errors}), 400

        batch = db.batch()
        count = 0
        for (school_id, route_id), rows in groups.items():
            stops = []
            for row in rows:
                stops.append({
                    "order": int(row["stop_order"]),
                    "name": str(row["stop_name"]),
                    "lat": float(row["lat"]),
                    "lng": float(row["lng"]),
                    "studentsCount": int(row["students_count"]),
                })
            ref = db.collection("routes").document(route_doc_id(school_id, route_id))
            batch.set(ref, {
                "routeId": route_id,
                "schoolId": school_id,
                "busId": cell_str(rows[0], "bus_id"),
                "stops": stops,
            })
            count += 1
        batch.commit()
        return jsonify({"count": count, "routes": count, "stops_total": len(df)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/routes/add", methods=["POST"])
def add_route():
    """
    Create/replace a single route from JSON, for the map pin-drop UI
    (as opposed to /upload/routes which takes a bulk Excel file).

    Body: {
      "route_id": "RT003",
      "school_id": "SCH001",
      "bus_id": "BUS001",
      "stops": [ { "name": str, "lat": num, "lng": num, "students_count": num }, ... ]
    }
    Stop order is taken from array order (1-indexed).
    """
    try:
        body = request.get_json(silent=True) or {}
        route_id = str(body.get("route_id", "")).strip()
        school_id = str(body.get("school_id", "")).strip()
        bus_id = str(body.get("bus_id", "")).strip()
        stops_in = body.get("stops", [])

        errors = []
        if not route_id:
            errors.append("route_id is required.")
        if school_id not in fetch_ids("schools"):
            errors.append(f"school_id '{school_id}' not found. Upload/create the school first.")
        if bus_id not in fetch_ids("buses"):
            errors.append(f"bus_id '{bus_id}' not found. Upload/create the bus first.")
        if not isinstance(stops_in, list) or len(stops_in) == 0:
            errors.append("At least one stop (pin) is required.")
        else:
            for i, s in enumerate(stops_in):
                label = f"Stop {i + 1}"
                if not str(s.get("name", "")).strip():
                    errors.append(f"{label}: name is required.")
                try:
                    float(s["lat"])
                    float(s["lng"])
                except (TypeError, ValueError, KeyError):
                    errors.append(f"{label}: lat/lng must be numeric.")
                try:
                    int(s.get("students_count", 0))
                except (TypeError, ValueError):
                    errors.append(f"{label}: students_count must be a whole number.")

        if errors:
            return jsonify({"error": "Validation failed", "details": errors}), 400

        stops = [
            {
                "order": i + 1,
                "name": str(s["name"]).strip(),
                "lat": float(s["lat"]),
                "lng": float(s["lng"]),
                "studentsCount": int(s.get("students_count", 0)),
            }
            for i, s in enumerate(stops_in)
        ]
        db.collection("routes").document(route_doc_id(school_id, route_id)).set({
            "routeId": route_id,
            "schoolId": school_id,
            "busId": bus_id,
            "stops": stops,
        })
        return jsonify({"count": 1, "stops_total": len(stops)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/upload/students", methods=["POST"])
def upload_students():
    try:
        df = read_excel_from_request()
        required = {"name", "school_id", "class", "section"}
        missing = required - set(df.columns)
        if missing:
            return jsonify({"error": f"Missing columns: {sorted(missing)}"}), 400

        existing_schools = fetch_ids("schools")
        errors = []
        for i, row in df.iterrows():
            excel_row = i + 2
            if not cell_str(row, "name"):
                errors.append(f"Row {excel_row}: name is required.")
            school_id = cell_str(row, "school_id")
            if school_id not in existing_schools:
                errors.append(
                    f"Row {excel_row}: school_id '{school_id}' not found. Upload Schools first."
                )
            if not cell_str(row, "class"):
                errors.append(f"Row {excel_row}: class is required.")
            if not cell_str(row, "section"):
                errors.append(f"Row {excel_row}: section is required.")
        if errors:
            return jsonify({"error": "Validation failed", "details": errors}), 400

        ids = next_ids("students", "STU", len(df))
        batch = db.batch()
        count = 0
        for doc_id, (_, row) in zip(ids, df.iterrows()):
            ref = db.collection("students").document(doc_id)
            batch.set(ref, {
                "name": str(row["name"]),
                "schoolId": str(row["school_id"]),
                "class": str(row["class"]),
                "section": str(row["section"]),
                "rollNo": cell_str(row, "roll_no"),
                "admissionNo": cell_str(row, "admission_no"),
                "parentName": cell_str(row, "parent_name"),
                "parentPhone": cell_str(row, "parent_phone"),
                "stopName": cell_str(row, "stop_name"),
            })
            count += 1
        batch.commit()
        return jsonify({"count": count})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/students/add", methods=["POST"])
def add_student():
    """Create/update a single student from JSON, for the manual-entry form
    (as opposed to /upload/students which takes a bulk Excel file)."""
    try:
        body = request.get_json(silent=True) or {}
        name = str(body.get("name", "")).strip()
        school_id = str(body.get("school_id", "")).strip()
        class_ = str(body.get("class", "")).strip()
        section = str(body.get("section", "")).strip()
        roll_no = str(body.get("roll_no", "")).strip()
        admission_no = str(body.get("admission_no", "")).strip()
        parent_name = str(body.get("parent_name", "")).strip()
        parent_phone = str(body.get("parent_phone", "")).strip()
        route_id = str(body.get("route_id", "")).strip()
        stop_name = str(body.get("stop_name", "")).strip()

        errors = []
        if not name:
            errors.append("name is required.")
        if school_id not in fetch_ids("schools"):
            errors.append(f"school_id '{school_id}' not found. Add the school first.")
        if not class_:
            errors.append("class is required.")
        if not section:
            errors.append("section is required.")
        if route_id and not db.collection("routes").document(route_id).get().exists:
            errors.append(f"route_id '{route_id}' not found.")
        if errors:
            return jsonify({"error": "Validation failed", "details": errors}), 400

        student_id = next_id("students", "STU")
        db.collection("students").document(student_id).set({
            "name": name,
            "schoolId": school_id,
            "class": class_,
            "section": section,
            "rollNo": roll_no,
            "admissionNo": admission_no,
            "parentName": parent_name,
            "parentPhone": parent_phone,
            "routeId": route_id,
            "stopName": stop_name,
        })
        return jsonify({"count": 1, "id": student_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/upload/exams", methods=["POST"])
def upload_exams():
    try:
        df = read_excel_from_request()
        required = {"name", "school_id", "class", "section", "date"}
        missing = required - set(df.columns)
        if missing:
            return jsonify({"error": f"Missing columns: {sorted(missing)}"}), 400

        existing_schools = fetch_ids("schools")
        errors = []
        for i, row in df.iterrows():
            excel_row = i + 2
            if not cell_str(row, "name"):
                errors.append(f"Row {excel_row}: name is required.")
            school_id = cell_str(row, "school_id")
            if school_id not in existing_schools:
                errors.append(
                    f"Row {excel_row}: school_id '{school_id}' not found. Upload Schools first."
                )
            if not cell_str(row, "class"):
                errors.append(f"Row {excel_row}: class is required.")
            if not cell_str(row, "section"):
                errors.append(f"Row {excel_row}: section is required.")
            if not cell_str(row, "date"):
                errors.append(f"Row {excel_row}: date is required.")
        if errors:
            return jsonify({"error": "Validation failed", "details": errors}), 400

        ids = next_ids("exams", "EXM", len(df))
        batch = db.batch()
        count = 0
        for doc_id, (_, row) in zip(ids, df.iterrows()):
            ref = db.collection("exams").document(doc_id)
            batch.set(ref, {
                "name": str(row["name"]),
                "schoolId": str(row["school_id"]),
                "class": str(row["class"]),
                "section": str(row["section"]),
                "date": str(row["date"]),
            })
            count += 1
        batch.commit()
        return jsonify({"count": count})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/exams/add", methods=["POST"])
def add_exam():
    """Create/update a single exam from JSON, for the manual-entry form
    (as opposed to /upload/exams which takes a bulk Excel file)."""
    try:
        body = request.get_json(silent=True) or {}
        name = str(body.get("name", "")).strip()
        school_id = str(body.get("school_id", "")).strip()
        class_ = str(body.get("class", "")).strip()
        section = str(body.get("section", "")).strip()
        date = str(body.get("date", "")).strip()

        errors = []
        if not name:
            errors.append("name is required.")
        if school_id not in fetch_ids("schools"):
            errors.append(f"school_id '{school_id}' not found. Add the school first.")
        if not class_:
            errors.append("class is required.")
        if not section:
            errors.append("section is required.")
        if not date:
            errors.append("date is required.")
        if errors:
            return jsonify({"error": "Validation failed", "details": errors}), 400

        exam_id = next_id("exams", "EXM")
        db.collection("exams").document(exam_id).set({
            "name": name,
            "schoolId": school_id,
            "class": class_,
            "section": section,
            "date": date,
        })
        return jsonify({"count": 1, "id": exam_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/upload/attendance", methods=["POST"])
def upload_attendance():
    """
    Expects one row per student. Rows sharing the same
    (school_id, class, section, date) are grouped into a single attendance
    document with a 'records' array.

    Columns: date, school_id, class, section, student_id, status
    """
    try:
        df = read_excel_from_request()
        required = {"date", "school_id", "class", "section", "student_id", "status"}
        missing = required - set(df.columns)
        if missing:
            return jsonify({"error": f"Missing columns: {sorted(missing)}"}), 400

        existing_schools = fetch_ids("schools")
        existing_students = fetch_ids("students")
        errors = []
        seen = set()
        groups = defaultdict(list)
        for i, row in df.iterrows():
            excel_row = i + 2
            date = cell_str(row, "date")
            school_id = cell_str(row, "school_id")
            class_ = cell_str(row, "class")
            section = cell_str(row, "section")
            student_id = cell_str(row, "student_id")
            status = cell_str(row, "status")
            if not date:
                errors.append(f"Row {excel_row}: date is required.")
            if school_id not in existing_schools:
                errors.append(
                    f"Row {excel_row}: school_id '{school_id}' not found. Upload Schools first."
                )
            if student_id not in existing_students:
                errors.append(
                    f"Row {excel_row}: student_id '{student_id}' not found. Upload Students first."
                )
            if status not in ("Present", "Absent"):
                errors.append(f"Row {excel_row}: status must be 'Present' or 'Absent'.")
            key = (school_id, class_, section, date, student_id)
            if key in seen:
                errors.append(f"Row {excel_row}: duplicate entry for student '{student_id}' on {date}.")
            seen.add(key)
            groups[(school_id, class_, section, date)].append(row)
        if errors:
            return jsonify({"error": "Validation failed", "details": errors}), 400

        batch = db.batch()
        count = 0
        for (school_id, class_, section, date), rows in groups.items():
            records = [
                {"studentId": cell_str(r, "student_id"), "status": cell_str(r, "status")}
                for r in rows
            ]
            ref = db.collection("attendance").document(
                attendance_doc_id(school_id, class_, section, date)
            )
            batch.set(ref, {
                "schoolId": school_id,
                "class": class_,
                "section": section,
                "date": date,
                "records": records,
            })
            count += 1
        batch.commit()
        return jsonify({"count": count, "records_total": len(df)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/attendance/add", methods=["POST"])
def add_attendance():
    """
    Create/replace one day's attendance for a class/section, for the manual
    marking UI (as opposed to /upload/attendance which takes a bulk Excel file).

    Body: {
      "school_id": "SCH001", "class": "10", "section": "A", "date": "2026-08-12",
      "records": [ { "student_id": "STU001", "status": "Present" }, ... ]
    }
    """
    try:
        body = request.get_json(silent=True) or {}
        school_id = str(body.get("school_id", "")).strip()
        class_ = str(body.get("class", "")).strip()
        section = str(body.get("section", "")).strip()
        date = str(body.get("date", "")).strip()
        records_in = body.get("records", [])

        existing_students = fetch_ids("students")
        errors = []
        if school_id not in fetch_ids("schools"):
            errors.append(f"school_id '{school_id}' not found. Add the school first.")
        if not class_:
            errors.append("class is required.")
        if not section:
            errors.append("section is required.")
        if not date:
            errors.append("date is required.")
        if not isinstance(records_in, list) or len(records_in) == 0:
            errors.append("At least one student record is required.")
        else:
            for i, r in enumerate(records_in):
                student_id = str(r.get("student_id", "")).strip()
                status = str(r.get("status", "")).strip()
                if student_id not in existing_students:
                    errors.append(f"Record {i + 1}: student_id '{student_id}' not found.")
                if status not in ("Present", "Absent"):
                    errors.append(f"Record {i + 1}: status must be 'Present' or 'Absent'.")
        if errors:
            return jsonify({"error": "Validation failed", "details": errors}), 400

        records = [
            {"studentId": str(r["student_id"]).strip(), "status": str(r["status"]).strip()}
            for r in records_in
        ]
        db.collection("attendance").document(
            attendance_doc_id(school_id, class_, section, date)
        ).set({
            "schoolId": school_id,
            "class": class_,
            "section": section,
            "date": date,
            "records": records,
        })
        return jsonify({"count": 1, "records_total": len(records)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/upload/timetable", methods=["POST"])
def upload_timetable():
    """
    Expects one row per period. Rows sharing the same
    (school_id, class, section) are grouped into a single timetable document
    with a 'periods' array.

    Columns: school_id, class, section, day, period_no, subject, teacher, start_time, end_time
    """
    try:
        df = read_excel_from_request()
        required = {
            "school_id", "class", "section", "day", "period_no",
            "subject", "teacher", "start_time", "end_time",
        }
        missing = required - set(df.columns)
        if missing:
            return jsonify({"error": f"Missing columns: {sorted(missing)}"}), 400

        existing_schools = fetch_ids("schools")
        errors = []
        for i, row in df.iterrows():
            excel_row = i + 2
            school_id = cell_str(row, "school_id")
            if school_id not in existing_schools:
                errors.append(
                    f"Row {excel_row}: school_id '{school_id}' not found. Upload Schools first."
                )
            if not cell_str(row, "class"):
                errors.append(f"Row {excel_row}: class is required.")
            if not cell_str(row, "section"):
                errors.append(f"Row {excel_row}: section is required.")
            if not cell_str(row, "day"):
                errors.append(f"Row {excel_row}: day is required.")
            if not cell_str(row, "subject"):
                errors.append(f"Row {excel_row}: subject is required.")
            try:
                int(row["period_no"])
            except (TypeError, ValueError):
                errors.append(f"Row {excel_row}: period_no must be a whole number.")
        if errors:
            return jsonify({"error": "Validation failed", "details": errors}), 400

        groups = defaultdict(list)
        for _, row in df.iterrows():
            groups[(cell_str(row, "school_id"), cell_str(row, "class"), cell_str(row, "section"))].append(row)

        batch = db.batch()
        count = 0
        for (school_id, class_, section), rows in groups.items():
            periods = [
                {
                    "day": cell_str(r, "day"),
                    "periodNo": int(r["period_no"]),
                    "subject": cell_str(r, "subject"),
                    "teacher": cell_str(r, "teacher"),
                    "startTime": cell_str(r, "start_time"),
                    "endTime": cell_str(r, "end_time"),
                }
                for r in rows
            ]
            ref = db.collection("timetable").document(
                timetable_doc_id(school_id, class_, section)
            )
            batch.set(ref, {
                "schoolId": school_id,
                "class": class_,
                "section": section,
                "periods": periods,
            })
            count += 1
        batch.commit()
        return jsonify({"count": count, "periods_total": len(df)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/timetable/add", methods=["POST"])
def add_timetable():
    """
    Create/replace the full timetable for a class/section, for the manual
    builder UI (as opposed to /upload/timetable which takes a bulk Excel file).

    Body: {
      "school_id": "SCH001", "class": "10", "section": "A",
      "periods": [ { "day", "period_no", "subject", "teacher", "start_time", "end_time" }, ... ]
    }
    """
    try:
        body = request.get_json(silent=True) or {}
        school_id = str(body.get("school_id", "")).strip()
        class_ = str(body.get("class", "")).strip()
        section = str(body.get("section", "")).strip()
        periods_in = body.get("periods", [])

        errors = []
        if school_id not in fetch_ids("schools"):
            errors.append(f"school_id '{school_id}' not found. Add the school first.")
        if not class_:
            errors.append("class is required.")
        if not section:
            errors.append("section is required.")
        if not isinstance(periods_in, list) or len(periods_in) == 0:
            errors.append("At least one period is required.")
        else:
            for i, p in enumerate(periods_in):
                if not str(p.get("subject", "")).strip():
                    errors.append(f"Period {i + 1}: subject is required.")
                if not str(p.get("day", "")).strip():
                    errors.append(f"Period {i + 1}: day is required.")
                try:
                    int(p.get("period_no"))
                except (TypeError, ValueError):
                    errors.append(f"Period {i + 1}: period_no must be a whole number.")
        if errors:
            return jsonify({"error": "Validation failed", "details": errors}), 400

        periods = [
            {
                "day": str(p["day"]).strip(),
                "periodNo": int(p["period_no"]),
                "subject": str(p["subject"]).strip(),
                "teacher": str(p.get("teacher", "")).strip(),
                "startTime": str(p.get("start_time", "")).strip(),
                "endTime": str(p.get("end_time", "")).strip(),
            }
            for p in periods_in
        ]
        db.collection("timetable").document(
            timetable_doc_id(school_id, class_, section)
        ).set({
            "schoolId": school_id,
            "class": class_,
            "section": section,
            "periods": periods,
        })
        return jsonify({"count": 1, "periods_total": len(periods)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/upload/results", methods=["POST"])
def upload_results():
    """
    Expects one row per student-subject mark. Rows sharing the same exam_id
    are grouped into a single results document with an 'entries' array.

    Columns: exam_id, school_id, class, section, student_id, subject, marks_obtained, max_marks
    """
    try:
        df = read_excel_from_request()
        required = {
            "exam_id", "school_id", "class", "section",
            "student_id", "subject", "marks_obtained", "max_marks",
        }
        missing = required - set(df.columns)
        if missing:
            return jsonify({"error": f"Missing columns: {sorted(missing)}"}), 400

        existing_exams = fetch_ids("exams")
        existing_students = fetch_ids("students")
        errors = []
        groups = defaultdict(list)
        for i, row in df.iterrows():
            excel_row = i + 2
            exam_id = cell_str(row, "exam_id")
            student_id = cell_str(row, "student_id")
            if exam_id not in existing_exams:
                errors.append(
                    f"Row {excel_row}: exam_id '{exam_id}' not found. Add the exam first."
                )
            if student_id not in existing_students:
                errors.append(
                    f"Row {excel_row}: student_id '{student_id}' not found. Upload Students first."
                )
            if not cell_str(row, "subject"):
                errors.append(f"Row {excel_row}: subject is required.")
            try:
                float(row["marks_obtained"])
                float(row["max_marks"])
            except (TypeError, ValueError):
                errors.append(f"Row {excel_row}: marks_obtained/max_marks must be numeric.")
            groups[exam_id].append(row)
        if errors:
            return jsonify({"error": "Validation failed", "details": errors}), 400

        batch = db.batch()
        count = 0
        for exam_id, rows in groups.items():
            first = rows[0]
            entries = [
                {
                    "studentId": cell_str(r, "student_id"),
                    "subject": cell_str(r, "subject"),
                    "marksObtained": float(r["marks_obtained"]),
                    "maxMarks": float(r["max_marks"]),
                }
                for r in rows
            ]
            ref = db.collection("results").document(exam_id)
            batch.set(ref, {
                "examId": exam_id,
                "schoolId": cell_str(first, "school_id"),
                "class": cell_str(first, "class"),
                "section": cell_str(first, "section"),
                "entries": entries,
            })
            count += 1
        batch.commit()
        return jsonify({"count": count, "entries_total": len(df)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/results/add", methods=["POST"])
def add_results():
    """
    Create/replace all marks for one exam, for the manual marks-entry UI
    (as opposed to /upload/results which takes a bulk Excel file).
    school_id/class/section are pulled from the exam document itself.

    Body: {
      "exam_id": "EXM001",
      "entries": [ { "student_id", "subject", "marks_obtained", "max_marks" }, ... ]
    }
    """
    try:
        body = request.get_json(silent=True) or {}
        exam_id = str(body.get("exam_id", "")).strip()
        entries_in = body.get("entries", [])

        exam_doc = db.collection("exams").document(exam_id).get()
        existing_students = fetch_ids("students")
        errors = []
        if not exam_doc.exists:
            errors.append(f"exam_id '{exam_id}' not found. Add the exam first.")
        if not isinstance(entries_in, list) or len(entries_in) == 0:
            errors.append("At least one mark entry is required.")
        else:
            for i, e in enumerate(entries_in):
                student_id = str(e.get("student_id", "")).strip()
                if student_id not in existing_students:
                    errors.append(f"Entry {i + 1}: student_id '{student_id}' not found.")
                if not str(e.get("subject", "")).strip():
                    errors.append(f"Entry {i + 1}: subject is required.")
                try:
                    float(e["marks_obtained"])
                    float(e["max_marks"])
                except (TypeError, ValueError, KeyError):
                    errors.append(f"Entry {i + 1}: marks_obtained/max_marks must be numeric.")
        if errors:
            return jsonify({"error": "Validation failed", "details": errors}), 400

        exam_data = exam_doc.to_dict()
        entries = [
            {
                "studentId": str(e["student_id"]).strip(),
                "subject": str(e["subject"]).strip(),
                "marksObtained": float(e["marks_obtained"]),
                "maxMarks": float(e["max_marks"]),
            }
            for e in entries_in
        ]
        db.collection("results").document(exam_id).set({
            "examId": exam_id,
            "schoolId": exam_data.get("schoolId", ""),
            "class": exam_data.get("class", ""),
            "section": exam_data.get("section", ""),
            "entries": entries,
        })
        return jsonify({"count": 1, "entries_total": len(entries)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/upload/admissions", methods=["POST"])
def upload_admissions():
    try:
        df = read_excel_from_request()
        required = {"name", "school_id", "class", "section"}
        missing = required - set(df.columns)
        if missing:
            return jsonify({"error": f"Missing columns: {sorted(missing)}"}), 400

        existing_schools = fetch_ids("schools")
        errors = []
        for i, row in df.iterrows():
            excel_row = i + 2
            if not cell_str(row, "name"):
                errors.append(f"Row {excel_row}: name is required.")
            school_id = cell_str(row, "school_id")
            if school_id not in existing_schools:
                errors.append(
                    f"Row {excel_row}: school_id '{school_id}' not found. Upload Schools first."
                )
            if not cell_str(row, "class"):
                errors.append(f"Row {excel_row}: class is required.")
            if not cell_str(row, "section"):
                errors.append(f"Row {excel_row}: section is required.")
        if errors:
            return jsonify({"error": "Validation failed", "details": errors}), 400

        ids = next_ids("admissions", "ADM", len(df))
        batch = db.batch()
        count = 0
        for doc_id, (_, row) in zip(ids, df.iterrows()):
            ref = db.collection("admissions").document(doc_id)
            batch.set(ref, {
                "name": str(row["name"]),
                "schoolId": str(row["school_id"]),
                "class": str(row["class"]),
                "section": str(row["section"]),
                "admissionNo": cell_str(row, "admission_no"),
                "parentName": cell_str(row, "parent_name"),
                "parentPhone": cell_str(row, "parent_phone"),
                "status": cell_str(row, "status") or "Enquiry",
            })
            count += 1
        batch.commit()
        return jsonify({"count": count})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/admissions/add", methods=["POST"])
def add_admission():
    """Create/update a single admission enquiry from JSON, for the
    manual-entry form (as opposed to /upload/admissions bulk Excel file)."""
    try:
        body = request.get_json(silent=True) or {}
        name = str(body.get("name", "")).strip()
        school_id = str(body.get("school_id", "")).strip()
        class_ = str(body.get("class", "")).strip()
        section = str(body.get("section", "")).strip()
        admission_no = str(body.get("admission_no", "")).strip()
        parent_name = str(body.get("parent_name", "")).strip()
        parent_phone = str(body.get("parent_phone", "")).strip()
        status = str(body.get("status", "")).strip() or "Enquiry"

        errors = []
        if not name:
            errors.append("name is required.")
        if school_id not in fetch_ids("schools"):
            errors.append(f"school_id '{school_id}' not found. Add the school first.")
        if not class_:
            errors.append("class is required.")
        if not section:
            errors.append("section is required.")
        if errors:
            return jsonify({"error": "Validation failed", "details": errors}), 400

        admission_id = next_id("admissions", "ADM")
        db.collection("admissions").document(admission_id).set({
            "name": name,
            "schoolId": school_id,
            "class": class_,
            "section": section,
            "admissionNo": admission_no,
            "parentName": parent_name,
            "parentPhone": parent_phone,
            "status": status,
        })
        return jsonify({"count": 1, "id": admission_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/admissions/<admission_id>/convert", methods=["POST"])
def convert_admission(admission_id):
    """Turn an approved admission enquiry into a real Students record, and
    mark the admission as Admitted so it isn't converted twice by mistake."""
    try:
        doc_ref = db.collection("admissions").document(admission_id)
        doc = doc_ref.get()
        if not doc.exists:
            return jsonify({"error": "Admission not found"}), 404
        data = doc.to_dict()

        student_id = next_id("students", "STU")
        db.collection("students").document(student_id).set({
            "name": data.get("name", ""),
            "schoolId": data.get("schoolId", ""),
            "class": data.get("class", ""),
            "section": data.get("section", ""),
            "rollNo": "",
            "admissionNo": data.get("admissionNo", ""),
            "admissionId": admission_id,
            "parentName": data.get("parentName", ""),
            "parentPhone": data.get("parentPhone", ""),
        })
        doc_ref.update({"status": "Admitted"})
        return jsonify({"count": 1, "student_id": student_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/upload/employees", methods=["POST"])
def upload_employees():
    try:
        df = read_excel_from_request()
        required = {"name", "school_id"}
        missing = required - set(df.columns)
        if missing:
            return jsonify({"error": f"Missing columns: {sorted(missing)}"}), 400

        existing_schools = fetch_ids("schools")
        errors = []
        for i, row in df.iterrows():
            excel_row = i + 2
            if not cell_str(row, "name"):
                errors.append(f"Row {excel_row}: name is required.")
            school_id = cell_str(row, "school_id")
            if school_id not in existing_schools:
                errors.append(
                    f"Row {excel_row}: school_id '{school_id}' not found. Upload Schools first."
                )
        if errors:
            return jsonify({"error": "Validation failed", "details": errors}), 400

        ids = next_ids("employees", "EMP", len(df))
        batch = db.batch()
        count = 0
        for doc_id, (_, row) in zip(ids, df.iterrows()):
            ref = db.collection("employees").document(doc_id)
            batch.set(ref, {
                "name": str(row["name"]),
                "schoolId": str(row["school_id"]),
                "staffType": cell_str(row, "staff_type"),
                "designation": cell_str(row, "designation"),
                "department": cell_str(row, "department"),
                "phone": cell_str(row, "phone"),
                "email": cell_str(row, "email"),
                "joiningDate": cell_str(row, "joining_date"),
            })
            count += 1
        batch.commit()
        return jsonify({"count": count})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/employees/add", methods=["POST"])
def add_employee():
    """Create/update a single employee from JSON, for the manual-entry form
    (as opposed to /upload/employees which takes a bulk Excel file)."""
    try:
        body = request.get_json(silent=True) or {}
        name = str(body.get("name", "")).strip()
        school_id = str(body.get("school_id", "")).strip()
        staff_type = str(body.get("staff_type", "")).strip()
        designation = str(body.get("designation", "")).strip()
        department = str(body.get("department", "")).strip()
        phone = str(body.get("phone", "")).strip()
        email = str(body.get("email", "")).strip()
        joining_date = str(body.get("joining_date", "")).strip()

        errors = []
        if not name:
            errors.append("name is required.")
        if school_id not in fetch_ids("schools"):
            errors.append(f"school_id '{school_id}' not found. Add the school first.")
        if staff_type and staff_type not in ("Teaching", "Non-Teaching"):
            errors.append("staff_type must be 'Teaching' or 'Non-Teaching'.")
        if errors:
            return jsonify({"error": "Validation failed", "details": errors}), 400

        employee_id = next_id("employees", "EMP")
        db.collection("employees").document(employee_id).set({
            "name": name,
            "schoolId": school_id,
            "staffType": staff_type,
            "designation": designation,
            "department": department,
            "phone": phone,
            "email": email,
            "joiningDate": joining_date,
        })
        return jsonify({"count": 1, "id": employee_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/upload/staff-attendance", methods=["POST"])
def upload_staff_attendance():
    """
    Expects one row per employee. Rows sharing the same (school_id, date)
    are grouped into a single staffAttendance document with a 'records' array.

    Columns: date, school_id, employee_id, status
    """
    try:
        df = read_excel_from_request()
        required = {"date", "school_id", "employee_id", "status"}
        missing = required - set(df.columns)
        if missing:
            return jsonify({"error": f"Missing columns: {sorted(missing)}"}), 400

        existing_schools = fetch_ids("schools")
        existing_employees = fetch_ids("employees")
        errors = []
        seen = set()
        groups = defaultdict(list)
        for i, row in df.iterrows():
            excel_row = i + 2
            date = cell_str(row, "date")
            school_id = cell_str(row, "school_id")
            employee_id = cell_str(row, "employee_id")
            status = cell_str(row, "status")
            if not date:
                errors.append(f"Row {excel_row}: date is required.")
            if school_id not in existing_schools:
                errors.append(
                    f"Row {excel_row}: school_id '{school_id}' not found. Upload Schools first."
                )
            if employee_id not in existing_employees:
                errors.append(
                    f"Row {excel_row}: employee_id '{employee_id}' not found. Upload Employees first."
                )
            if status not in ("Present", "Absent"):
                errors.append(f"Row {excel_row}: status must be 'Present' or 'Absent'.")
            key = (school_id, date, employee_id)
            if key in seen:
                errors.append(f"Row {excel_row}: duplicate entry for employee '{employee_id}' on {date}.")
            seen.add(key)
            groups[(school_id, date)].append(row)
        if errors:
            return jsonify({"error": "Validation failed", "details": errors}), 400

        batch = db.batch()
        count = 0
        for (school_id, date), rows in groups.items():
            records = [
                {"employeeId": cell_str(r, "employee_id"), "status": cell_str(r, "status")}
                for r in rows
            ]
            ref = db.collection("staffAttendance").document(
                staff_attendance_doc_id(school_id, date)
            )
            batch.set(ref, {
                "schoolId": school_id,
                "date": date,
                "records": records,
            })
            count += 1
        batch.commit()
        return jsonify({"count": count, "records_total": len(df)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/staff-attendance/add", methods=["POST"])
def add_staff_attendance():
    """
    Create/replace one day's attendance for a school's staff, for the manual
    marking UI (as opposed to /upload/staff-attendance bulk Excel file).

    Body: {
      "school_id": "SCH001", "date": "2026-08-12",
      "records": [ { "employee_id": "EMP001", "status": "Present" }, ... ]
    }
    """
    try:
        body = request.get_json(silent=True) or {}
        school_id = str(body.get("school_id", "")).strip()
        date = str(body.get("date", "")).strip()
        records_in = body.get("records", [])

        existing_employees = fetch_ids("employees")
        errors = []
        if school_id not in fetch_ids("schools"):
            errors.append(f"school_id '{school_id}' not found. Add the school first.")
        if not date:
            errors.append("date is required.")
        if not isinstance(records_in, list) or len(records_in) == 0:
            errors.append("At least one employee record is required.")
        else:
            for i, r in enumerate(records_in):
                employee_id = str(r.get("employee_id", "")).strip()
                status = str(r.get("status", "")).strip()
                if employee_id not in existing_employees:
                    errors.append(f"Record {i + 1}: employee_id '{employee_id}' not found.")
                if status not in ("Present", "Absent"):
                    errors.append(f"Record {i + 1}: status must be 'Present' or 'Absent'.")
        if errors:
            return jsonify({"error": "Validation failed", "details": errors}), 400

        records = [
            {"employeeId": str(r["employee_id"]).strip(), "status": str(r["status"]).strip()}
            for r in records_in
        ]
        db.collection("staffAttendance").document(
            staff_attendance_doc_id(school_id, date)
        ).set({
            "schoolId": school_id,
            "date": date,
            "records": records,
        })
        return jsonify({"count": 1, "records_total": len(records)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/upload/leaves", methods=["POST"])
def upload_leaves():
    try:
        df = read_excel_from_request()
        required = {"employee_id", "from_date", "to_date"}
        missing = required - set(df.columns)
        if missing:
            return jsonify({"error": f"Missing columns: {sorted(missing)}"}), 400

        existing_employees = fetch_ids("employees")
        errors = []
        for i, row in df.iterrows():
            excel_row = i + 2
            employee_id = cell_str(row, "employee_id")
            if employee_id not in existing_employees:
                errors.append(
                    f"Row {excel_row}: employee_id '{employee_id}' not found. Upload Employees first."
                )
            if not cell_str(row, "from_date"):
                errors.append(f"Row {excel_row}: from_date is required.")
            if not cell_str(row, "to_date"):
                errors.append(f"Row {excel_row}: to_date is required.")
        if errors:
            return jsonify({"error": "Validation failed", "details": errors}), 400

        ids = next_ids("leaves", "LVE", len(df))
        batch = db.batch()
        count = 0
        for doc_id, (_, row) in zip(ids, df.iterrows()):
            ref = db.collection("leaves").document(doc_id)
            batch.set(ref, {
                "employeeId": str(row["employee_id"]),
                "fromDate": str(row["from_date"]),
                "toDate": str(row["to_date"]),
                "reason": cell_str(row, "reason"),
                "status": cell_str(row, "status") or "Pending",
            })
            count += 1
        batch.commit()
        return jsonify({"count": count})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/leaves/add", methods=["POST"])
def add_leave():
    """Create/update a single leave request from JSON, for the manual-entry
    form (as opposed to /upload/leaves which takes a bulk Excel file)."""
    try:
        body = request.get_json(silent=True) or {}
        employee_id = str(body.get("employee_id", "")).strip()
        from_date = str(body.get("from_date", "")).strip()
        to_date = str(body.get("to_date", "")).strip()
        reason = str(body.get("reason", "")).strip()
        status = str(body.get("status", "")).strip() or "Pending"

        errors = []
        if employee_id not in fetch_ids("employees"):
            errors.append(f"employee_id '{employee_id}' not found. Add the employee first.")
        if not from_date:
            errors.append("from_date is required.")
        if not to_date:
            errors.append("to_date is required.")
        if errors:
            return jsonify({"error": "Validation failed", "details": errors}), 400

        leave_id = next_id("leaves", "LVE")
        db.collection("leaves").document(leave_id).set({
            "employeeId": employee_id,
            "fromDate": from_date,
            "toDate": to_date,
            "reason": reason,
            "status": status,
        })
        return jsonify({"count": 1, "id": leave_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/upload/fee-structure", methods=["POST"])
def upload_fee_structure():
    try:
        df = read_excel_from_request()
        required = {"school_id", "class", "fee_type", "amount"}
        missing = required - set(df.columns)
        if missing:
            return jsonify({"error": f"Missing columns: {sorted(missing)}"}), 400

        existing_schools = fetch_ids("schools")
        errors = []
        for i, row in df.iterrows():
            excel_row = i + 2
            school_id = cell_str(row, "school_id")
            if school_id not in existing_schools:
                errors.append(
                    f"Row {excel_row}: school_id '{school_id}' not found. Upload Schools first."
                )
            if not cell_str(row, "class"):
                errors.append(f"Row {excel_row}: class is required.")
            if not cell_str(row, "fee_type"):
                errors.append(f"Row {excel_row}: fee_type is required.")
            try:
                float(row["amount"])
            except (TypeError, ValueError):
                errors.append(f"Row {excel_row}: amount must be numeric.")
        if errors:
            return jsonify({"error": "Validation failed", "details": errors}), 400

        ids = next_ids("feeStructure", "FST", len(df))
        batch = db.batch()
        count = 0
        for doc_id, (_, row) in zip(ids, df.iterrows()):
            ref = db.collection("feeStructure").document(doc_id)
            batch.set(ref, {
                "schoolId": str(row["school_id"]),
                "class": str(row["class"]),
                "feeType": str(row["fee_type"]),
                "amount": float(row["amount"]),
            })
            count += 1
        batch.commit()
        return jsonify({"count": count})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/fee-structure/add", methods=["POST"])
def add_fee_structure():
    """Create/update a single fee structure line from JSON, for the
    manual-entry form (as opposed to /upload/fee-structure bulk Excel file)."""
    try:
        body = request.get_json(silent=True) or {}
        school_id = str(body.get("school_id", "")).strip()
        class_ = str(body.get("class", "")).strip()
        fee_type = str(body.get("fee_type", "")).strip()
        amount_raw = body.get("amount")

        errors = []
        if school_id not in fetch_ids("schools"):
            errors.append(f"school_id '{school_id}' not found. Add the school first.")
        if not class_:
            errors.append("class is required.")
        if not fee_type:
            errors.append("fee_type is required.")
        try:
            amount = float(amount_raw)
        except (TypeError, ValueError):
            errors.append("amount must be numeric.")
            amount = None
        if errors:
            return jsonify({"error": "Validation failed", "details": errors}), 400

        fee_id = next_id("feeStructure", "FST")
        db.collection("feeStructure").document(fee_id).set({
            "schoolId": school_id,
            "class": class_,
            "feeType": fee_type,
            "amount": amount,
        })
        return jsonify({"count": 1, "id": fee_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/upload/fee-payments", methods=["POST"])
def upload_fee_payments():
    try:
        df = read_excel_from_request()
        required = {"student_id", "amount_paid", "payment_date"}
        missing = required - set(df.columns)
        if missing:
            return jsonify({"error": f"Missing columns: {sorted(missing)}"}), 400

        existing_students = fetch_ids("students")
        errors = []
        for i, row in df.iterrows():
            excel_row = i + 2
            student_id = cell_str(row, "student_id")
            if student_id not in existing_students:
                errors.append(
                    f"Row {excel_row}: student_id '{student_id}' not found. Upload Students first."
                )
            try:
                float(row["amount_paid"])
            except (TypeError, ValueError):
                errors.append(f"Row {excel_row}: amount_paid must be numeric.")
            if not cell_str(row, "payment_date"):
                errors.append(f"Row {excel_row}: payment_date is required.")
        if errors:
            return jsonify({"error": "Validation failed", "details": errors}), 400

        ids = next_ids("feePayments", "PAY", len(df))
        batch = db.batch()
        count = 0
        for doc_id, (_, row) in zip(ids, df.iterrows()):
            ref = db.collection("feePayments").document(doc_id)
            batch.set(ref, {
                "studentId": str(row["student_id"]),
                "feeType": cell_str(row, "fee_type"),
                "amountPaid": float(row["amount_paid"]),
                "paymentDate": str(row["payment_date"]),
                "mode": cell_str(row, "mode"),
                "remarks": cell_str(row, "remarks"),
            })
            count += 1
        batch.commit()
        return jsonify({"count": count})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/fee-payments/add", methods=["POST"])
def add_fee_payment():
    """Create/update a single fee payment from JSON, for the manual-entry
    form (as opposed to /upload/fee-payments which takes a bulk Excel file)."""
    try:
        body = request.get_json(silent=True) or {}
        student_id = str(body.get("student_id", "")).strip()
        fee_type = str(body.get("fee_type", "")).strip()
        amount_raw = body.get("amount_paid")
        payment_date = str(body.get("payment_date", "")).strip()
        mode = str(body.get("mode", "")).strip()
        remarks = str(body.get("remarks", "")).strip()

        errors = []
        if student_id not in fetch_ids("students"):
            errors.append(f"student_id '{student_id}' not found. Add the student first.")
        try:
            amount_paid = float(amount_raw)
        except (TypeError, ValueError):
            errors.append("amount_paid must be numeric.")
            amount_paid = None
        if not payment_date:
            errors.append("payment_date is required.")
        if errors:
            return jsonify({"error": "Validation failed", "details": errors}), 400

        payment_id = next_id("feePayments", "PAY")
        db.collection("feePayments").document(payment_id).set({
            "studentId": student_id,
            "feeType": fee_type,
            "amountPaid": amount_paid,
            "paymentDate": payment_date,
            "mode": mode,
            "remarks": remarks,
        })
        return jsonify({"count": 1, "id": payment_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/upload/visitors", methods=["POST"])
def upload_visitors():
    try:
        df = read_excel_from_request()
        required = {"name", "purpose", "date"}
        missing = required - set(df.columns)
        if missing:
            return jsonify({"error": f"Missing columns: {sorted(missing)}"}), 400

        errors = []
        for i, row in df.iterrows():
            excel_row = i + 2
            if not cell_str(row, "name"):
                errors.append(f"Row {excel_row}: name is required.")
            if not cell_str(row, "purpose"):
                errors.append(f"Row {excel_row}: purpose is required.")
            if not cell_str(row, "date"):
                errors.append(f"Row {excel_row}: date is required.")
        if errors:
            return jsonify({"error": "Validation failed", "details": errors}), 400

        ids = next_ids("visitors", "VIS", len(df))
        batch = db.batch()
        count = 0
        for doc_id, (_, row) in zip(ids, df.iterrows()):
            ref = db.collection("visitors").document(doc_id)
            batch.set(ref, {
                "name": str(row["name"]),
                "phone": cell_str(row, "phone"),
                "purpose": str(row["purpose"]),
                "meetWhom": cell_str(row, "meet_whom"),
                "date": str(row["date"]),
                "inTime": cell_str(row, "in_time"),
                "outTime": cell_str(row, "out_time"),
            })
            count += 1
        batch.commit()
        return jsonify({"count": count})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/visitors/add", methods=["POST"])
def add_visitor():
    """Create/update a single visitor entry from JSON, for the manual-entry
    form (as opposed to /upload/visitors which takes a bulk Excel file)."""
    try:
        body = request.get_json(silent=True) or {}
        name = str(body.get("name", "")).strip()
        phone = str(body.get("phone", "")).strip()
        purpose = str(body.get("purpose", "")).strip()
        meet_whom = str(body.get("meet_whom", "")).strip()
        date = str(body.get("date", "")).strip()
        in_time = str(body.get("in_time", "")).strip()
        out_time = str(body.get("out_time", "")).strip()

        errors = []
        if not name:
            errors.append("name is required.")
        if not purpose:
            errors.append("purpose is required.")
        if not date:
            errors.append("date is required.")
        if errors:
            return jsonify({"error": "Validation failed", "details": errors}), 400

        visitor_id = next_id("visitors", "VIS")
        db.collection("visitors").document(visitor_id).set({
            "name": name,
            "phone": phone,
            "purpose": purpose,
            "meetWhom": meet_whom,
            "date": date,
            "inTime": in_time,
            "outTime": out_time,
        })
        return jsonify({"count": 1, "id": visitor_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/upload/enquiries", methods=["POST"])
def upload_enquiries():
    try:
        df = read_excel_from_request()
        required = {"name", "query"}
        missing = required - set(df.columns)
        if missing:
            return jsonify({"error": f"Missing columns: {sorted(missing)}"}), 400

        errors = []
        for i, row in df.iterrows():
            excel_row = i + 2
            if not cell_str(row, "name"):
                errors.append(f"Row {excel_row}: name is required.")
            if not cell_str(row, "query"):
                errors.append(f"Row {excel_row}: query is required.")
        if errors:
            return jsonify({"error": "Validation failed", "details": errors}), 400

        ids = next_ids("enquiries", "ENQ", len(df))
        batch = db.batch()
        count = 0
        for doc_id, (_, row) in zip(ids, df.iterrows()):
            ref = db.collection("enquiries").document(doc_id)
            batch.set(ref, {
                "name": str(row["name"]),
                "phone": cell_str(row, "phone"),
                "query": str(row["query"]),
                "status": cell_str(row, "status") or "New",
            })
            count += 1
        batch.commit()
        return jsonify({"count": count})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/enquiries/add", methods=["POST"])
def add_enquiry():
    """Create/update a single enquiry from JSON, for the manual-entry form
    (as opposed to /upload/enquiries which takes a bulk Excel file)."""
    try:
        body = request.get_json(silent=True) or {}
        name = str(body.get("name", "")).strip()
        phone = str(body.get("phone", "")).strip()
        query = str(body.get("query", "")).strip()
        status = str(body.get("status", "")).strip() or "New"

        errors = []
        if not name:
            errors.append("name is required.")
        if not query:
            errors.append("query is required.")
        if errors:
            return jsonify({"error": "Validation failed", "details": errors}), 400

        enquiry_id = next_id("enquiries", "ENQ")
        db.collection("enquiries").document(enquiry_id).set({
            "name": name,
            "phone": phone,
            "query": query,
            "status": status,
        })
        return jsonify({"count": 1, "id": enquiry_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/upload/gate-passes", methods=["POST"])
def upload_gate_passes():
    try:
        df = read_excel_from_request()
        required = {"student_id", "reason", "date"}
        missing = required - set(df.columns)
        if missing:
            return jsonify({"error": f"Missing columns: {sorted(missing)}"}), 400

        existing_students = fetch_ids("students")
        errors = []
        for i, row in df.iterrows():
            excel_row = i + 2
            student_id = cell_str(row, "student_id")
            if student_id not in existing_students:
                errors.append(
                    f"Row {excel_row}: student_id '{student_id}' not found. Upload Students first."
                )
            if not cell_str(row, "reason"):
                errors.append(f"Row {excel_row}: reason is required.")
            if not cell_str(row, "date"):
                errors.append(f"Row {excel_row}: date is required.")
        if errors:
            return jsonify({"error": "Validation failed", "details": errors}), 400

        ids = next_ids("gatePasses", "GP", len(df))
        batch = db.batch()
        count = 0
        for doc_id, (_, row) in zip(ids, df.iterrows()):
            ref = db.collection("gatePasses").document(doc_id)
            batch.set(ref, {
                "studentId": str(row["student_id"]),
                "reason": str(row["reason"]),
                "date": str(row["date"]),
                "timeOut": cell_str(row, "time_out"),
                "approvedBy": cell_str(row, "approved_by"),
            })
            count += 1
        batch.commit()
        return jsonify({"count": count})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/gate-passes/add", methods=["POST"])
def add_gate_pass():
    """Create/update a single gate pass from JSON, for the manual-entry form
    (as opposed to /upload/gate-passes which takes a bulk Excel file)."""
    try:
        body = request.get_json(silent=True) or {}
        student_id = str(body.get("student_id", "")).strip()
        reason = str(body.get("reason", "")).strip()
        date = str(body.get("date", "")).strip()
        time_out = str(body.get("time_out", "")).strip()
        approved_by = str(body.get("approved_by", "")).strip()

        errors = []
        if student_id not in fetch_ids("students"):
            errors.append(f"student_id '{student_id}' not found. Add the student first.")
        if not reason:
            errors.append("reason is required.")
        if not date:
            errors.append("date is required.")
        if errors:
            return jsonify({"error": "Validation failed", "details": errors}), 400

        pass_id = next_id("gatePasses", "GP")
        db.collection("gatePasses").document(pass_id).set({
            "studentId": student_id,
            "reason": reason,
            "date": date,
            "timeOut": time_out,
            "approvedBy": approved_by,
        })
        return jsonify({"count": 1, "id": pass_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
