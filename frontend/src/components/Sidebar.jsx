import React from "react";
import { NavLink } from "react-router-dom";
import {
  HomeIcon,
  EmployeesIcon,
  AdmissionIcon,
  StudentIcon,
  FeeIcon,
  AttendanceIcon,
  ExaminationIcon,
  TransportIcon,
  UploadIcon,
  VisitorIcon,
} from "./icons.jsx";

const ITEMS = [
  { to: "/", label: "Dashboard", icon: HomeIcon },
  { to: "/upload/employees", label: "Employee Portal", icon: EmployeesIcon },
  { to: "/upload/admissions", label: "Admission", icon: AdmissionIcon },
  { to: "/upload/students", label: "Student", icon: StudentIcon },
  { to: "/upload/feeStructure", label: "Fee", icon: FeeIcon },
  { to: "/upload/visitors", label: "Front Desk", icon: VisitorIcon },
  { to: "/employees/attendance", label: "Attendance", icon: AttendanceIcon },
  { to: "/exams/marks-entry", label: "Examination", icon: ExaminationIcon },
  { to: "/transport", label: "Transport", icon: TransportIcon },
  { to: "/upload", label: "Upload Data", icon: UploadIcon },
];

export default function Sidebar() {
  return (
    <aside className="sidebar">
      {ITEMS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end
          className={({ isActive }) => (isActive ? "sidebar-link active" : "sidebar-link")}
        >
          <Icon />
          <span>{label}</span>
        </NavLink>
      ))}
    </aside>
  );
}
