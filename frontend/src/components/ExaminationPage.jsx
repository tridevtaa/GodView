import React, { useState } from "react";
import DirectoryPage from "./DirectoryPage.jsx";
import Tabs from "./Tabs.jsx";
import MarksEntryPanel from "./MarksEntryPanel.jsx";
import { useCollectionIds } from "./entityApi.jsx";

const TABS = [
  { key: "exams", label: "Exams" },
  { key: "marks", label: "Marks Entry" },
];

export default function ExaminationPage() {
  const [tab, setTab] = useState("exams");
  const schoolIds = useCollectionIds("schools");

  return (
    <div>
      <div className="module-tabs-bar">
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
      </div>

      {tab === "exams" ? (
        <DirectoryPage
          title="Exams"
          singularLabel="Exam"
          collection="exams"
          addEndpoint="/exams/add"
          selectOptions={{ school_id: schoolIds }}
          summaryKeys={["class", "section", "date"]}
          filterField="class"
          filterLabel="Class"
          fields={[
            { name: "name", label: "Exam Name", required: true, placeholder: "Term 1" },
            { name: "school_id", label: "School", type: "select", required: true },
            { name: "class", label: "Class", required: true, placeholder: "10" },
            { name: "section", label: "Section", required: true, placeholder: "A" },
            { name: "date", label: "Date", required: true, placeholder: "2026-09-01" },
          ]}
          excel={{
            endpoint: "/upload/exams",
            templateHint: "Columns: name, school_id, class, section, date",
            templateFile: "exams_template.xlsx",
          }}
        />
      ) : (
        <MarksEntryPanel />
      )}
    </div>
  );
}
