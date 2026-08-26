import React, { useState } from "react";
import DirectoryPage from "./DirectoryPage.jsx";
import Tabs from "./Tabs.jsx";
import { useRecords } from "./entityApi.jsx";

const TABS = [
  { key: "visitors", label: "Visitors" },
  { key: "enquiries", label: "Enquiries" },
  { key: "gatepasses", label: "Gate Passes" },
];

export default function FrontDeskPage() {
  const [tab, setTab] = useState("visitors");
  const students = useRecords("students");

  const studentOptions = (students || []).map((s) => ({
    value: s.id,
    label: `${s.name} · ${s.class}${s.section || ""} (${s.id})`,
  }));

  return (
    <div>
      <div className="module-tabs-bar">
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
      </div>

      {tab === "visitors" && (
        <DirectoryPage
          title="Visitors"
          singularLabel="Visitor"
          collection="visitors"
          addEndpoint="/visitors/add"
          summaryKeys={["purpose", "date", "inTime"]}
          fields={[
            { name: "name", label: "Name", required: true, placeholder: "Ramesh Kumar" },
            { name: "phone", label: "Phone", placeholder: "9876500002" },
            { name: "purpose", label: "Purpose", required: true, placeholder: "Meeting principal" },
            { name: "meet_whom", label: "Meeting Whom", placeholder: "Principal" },
            { name: "date", label: "Date", required: true, placeholder: "2026-08-26" },
            { name: "in_time", label: "In Time", placeholder: "10:00" },
            { name: "out_time", label: "Out Time", placeholder: "10:30" },
          ]}
          excel={{
            endpoint: "/upload/visitors",
            templateHint: "Columns: name, phone, purpose, meet_whom, date, in_time, out_time",
            templateFile: "visitors_template.xlsx",
          }}
        />
      )}

      {tab === "enquiries" && (
        <DirectoryPage
          title="Enquiries"
          singularLabel="Enquiry"
          collection="enquiries"
          addEndpoint="/enquiries/add"
          selectOptions={{ status: ["New", "Contacted", "Closed"] }}
          summaryKeys={["query", "status"]}
          filterField="status"
          filterLabel="Status"
          fields={[
            { name: "name", label: "Name", required: true, placeholder: "Sunita Verma" },
            { name: "phone", label: "Phone", placeholder: "9876500004" },
            { name: "query", label: "Query", required: true, placeholder: "Admission for class 5" },
            { name: "status", label: "Status", type: "select" },
          ]}
          excel={{
            endpoint: "/upload/enquiries",
            templateHint: "Columns: name, phone, query, status (optional, defaults to New)",
            templateFile: "enquiries_template.xlsx",
          }}
        />
      )}

      {tab === "gatepasses" && (
        <DirectoryPage
          title="Gate Passes"
          singularLabel="Gate Pass"
          collection="gatePasses"
          addEndpoint="/gate-passes/add"
          selectOptions={{ student_id: studentOptions }}
          summaryKeys={["reason", "date", "timeOut"]}
          fields={[
            { name: "student_id", label: "Student", type: "select", required: true },
            { name: "reason", label: "Reason", required: true, placeholder: "Doctor appointment" },
            { name: "date", label: "Date", required: true, placeholder: "2026-08-26" },
            { name: "time_out", label: "Time Out", placeholder: "13:00" },
            { name: "approved_by", label: "Approved By", placeholder: "Class teacher" },
          ]}
          excel={{
            endpoint: "/upload/gate-passes",
            templateHint: "Columns: student_id, reason, date, time_out, approved_by",
            templateFile: "gate_passes_template.xlsx",
          }}
        />
      )}
    </div>
  );
}
