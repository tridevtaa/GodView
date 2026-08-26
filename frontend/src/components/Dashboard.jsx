import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase.js";
import {
  AttendanceIcon,
  RouteIcon,
  EmployeesIcon,
  StudentIcon,
  TransportIcon,
  AdmissionIcon,
  FeeIcon,
  ExaminationIcon,
  VisitorIcon,
} from "./icons.jsx";

const QUICK_ACTION_GROUPS = [
  {
    title: "Student",
    color: "#2563eb",
    items: [
      { to: "/students", label: "Add Student", icon: StudentIcon },
      { to: "/admissions", label: "Admissions", icon: AdmissionIcon },
      { to: "/attendance", label: "Student Attendance", icon: AttendanceIcon },
    ],
  },
  {
    title: "Employees",
    color: "#db2777",
    items: [
      { to: "/employees", label: "Employee Portal", icon: EmployeesIcon },
      { to: "/attendance?tab=staff", label: "Staff Attendance", icon: AttendanceIcon },
    ],
  },
  {
    title: "Fee & Examination",
    color: "#059669",
    items: [
      { to: "/fee", label: "Fee", icon: FeeIcon },
      { to: "/examination", label: "Examination", icon: ExaminationIcon },
    ],
  },
  {
    title: "Front Desk",
    color: "#7c3aed",
    items: [
      { to: "/front-desk", label: "Front Desk", icon: VisitorIcon },
    ],
  },
  {
    title: "Transport",
    color: "#ea580c",
    items: [
      { to: "/schools", label: "Schools", icon: RouteIcon },
      { to: "/drivers", label: "Drivers", icon: EmployeesIcon },
      { to: "/buses", label: "Buses", icon: TransportIcon },
      { to: "/add-route", label: "Add / Upload Routes", icon: RouteIcon },
      { to: "/transport", label: "Transport Map", icon: TransportIcon },
    ],
  },
];

function useCount(collectionName, filterFn) {
  const [count, setCount] = useState(null);
  useEffect(() => {
    let cancelled = false;
    getDocs(collection(db, collectionName))
      .then((snap) => {
        if (cancelled) return;
        const docs = snap.docs.map((d) => d.data());
        setCount(filterFn ? docs.filter(filterFn).length : docs.length);
      })
      .catch(() => {
        if (!cancelled) setCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [collectionName]);
  return count;
}

function StatCard({ label, value, icon: Icon }) {
  return (
    <div className="stat-card">
      <span className="stat-card-icon">
        <Icon />
      </span>
      <div>
        <div className="stat-card-value">{value === null ? "…" : value}</div>
        <div className="stat-card-label">{label}</div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const schoolCount = useCount("schools");
  const studentCount = useCount("students");
  const employeeCount = useCount("employees");

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <h1>Welcome to GodView</h1>
        <p>Manage your school, one module at a time.</p>
      </div>

      <div className="stat-row">
        <StatCard label="Schools" value={schoolCount} icon={RouteIcon} />
        <StatCard label="Students" value={studentCount} icon={StudentIcon} />
        <StatCard label="Employees" value={employeeCount} icon={EmployeesIcon} />
      </div>

      {QUICK_ACTION_GROUPS.map((group) => (
        <div key={group.title} className="quick-actions-group">
          <h2 className="dashboard-section-title">{group.title}</h2>
          <div className="quick-actions">
            {group.items.map(({ to, label, icon: Icon }) => (
              <Link key={to} to={to} className="quick-action-card">
                <span className="quick-action-icon" style={{ color: group.color }}>
                  <Icon />
                </span>
                <span className="quick-action-label">{label}</span>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
