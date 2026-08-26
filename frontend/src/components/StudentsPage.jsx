import React from "react";
import { Link } from "react-router-dom";
import DirectoryPage from "./DirectoryPage.jsx";
import StudentProfile from "./StudentProfile.jsx";
import { useCollectionIds, useRecords } from "./entityApi.jsx";

export default function StudentsPage() {
  const schoolIds = useCollectionIds("schools");
  const routes = useRecords("routes");

  const routeOptions = (routes || []).map((r) => ({
    value: r.id,
    label: `${r.routeId} · Bus ${r.busId} (${r.schoolId})`,
  }));

  return (
    <DirectoryPage
      title="Students"
      singularLabel="Student"
      collection="students"
      addEndpoint="/students/add"
      selectOptions={{ school_id: schoolIds, route_id: routeOptions }}
      summaryKeys={["class", "section", "rollNo"]}
      filterField="class"
      filterLabel="Class"
      renderDetail={(student) => <StudentProfile student={student} />}
      addPanelFooter={
        <Link to="/schools" className="directory-footer-link">
          Manage schools →
        </Link>
      }
      fields={[
        { name: "name", label: "Name", required: true, placeholder: "Aarav Sharma" },
        { name: "school_id", label: "School", type: "select", required: true },
        { name: "class", label: "Class", required: true, placeholder: "10" },
        { name: "section", label: "Section", required: true, placeholder: "A" },
        { name: "roll_no", label: "Roll No.", placeholder: "12" },
        { name: "admission_no", label: "Admission No.", placeholder: "AD-2026-001" },
        { name: "parent_name", label: "Parent Name", placeholder: "Rakesh Sharma" },
        { name: "parent_phone", label: "Parent Phone", placeholder: "9876500001" },
        { name: "route_id", label: "Transport Route", type: "select" },
        { name: "stop_name", label: "Stop Name", placeholder: "Sector 12 Market" },
      ]}
      excel={{
        endpoint: "/upload/students",
        templateHint:
          "Columns: name, school_id, class, section, roll_no, admission_no, parent_name, parent_phone, stop_name (optional; student_id is assigned automatically)",
        templateFile: "students_template.xlsx",
      }}
    />
  );
}
