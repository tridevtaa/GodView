import React from "react";
import { NavLink } from "react-router-dom";
import {
  HomeIcon,
  EmployeesIcon,
  StudentIcon,
  TransportIcon,
  AdmissionIcon,
  FeeIcon,
  AttendanceIcon,
  ExaminationIcon,
  VisitorIcon,
} from "./icons.jsx";

const ITEMS = [
  { to: "/", label: "Dashboard", icon: HomeIcon },
  { to: "/students", label: "Student", icon: StudentIcon },
  { to: "/admissions", label: "Admission", icon: AdmissionIcon },
  { to: "/fee", label: "Fee", icon: FeeIcon },
  { to: "/attendance", label: "Attendance", icon: AttendanceIcon },
  { to: "/examination", label: "Examination", icon: ExaminationIcon },
  { to: "/front-desk", label: "Front Desk", icon: VisitorIcon },
  { to: "/employees", label: "Employee Portal", icon: EmployeesIcon },
  { to: "/transport", label: "Transport", icon: TransportIcon },
];

export default function Sidebar() {
  return (
    <nav className="top-nav">
      {ITEMS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end
          className={({ isActive }) => (isActive ? "top-nav-link active" : "top-nav-link")}
        >
          <Icon />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
