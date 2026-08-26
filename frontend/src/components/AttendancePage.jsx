import React from "react";
import { useSearchParams } from "react-router-dom";
import Tabs from "./Tabs.jsx";
import StudentAttendancePage from "./StudentAttendancePage.jsx";
import EmployeeAttendancePage from "./EmployeeAttendancePage.jsx";

const TABS = [
  { key: "student", label: "Student" },
  { key: "staff", label: "Staff" },
];

export default function AttendancePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "staff" ? "staff" : "student";

  function setTab(next) {
    setSearchParams(next === "student" ? {} : { tab: next });
  }

  return (
    <div>
      <div className="module-tabs-bar">
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
      </div>

      {tab === "student" ? <StudentAttendancePage /> : <EmployeeAttendancePage />}
    </div>
  );
}
