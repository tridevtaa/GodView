import React from "react";
import { Link } from "react-router-dom";
import DirectoryPage from "./DirectoryPage.jsx";
import AdmissionProfile from "./AdmissionProfile.jsx";
import { useCollectionIds } from "./entityApi.jsx";

export default function AdmissionsPage() {
  const schoolIds = useCollectionIds("schools");

  return (
    <DirectoryPage
      title="Admissions"
      singularLabel="Admission"
      collection="admissions"
      addEndpoint="/admissions/add"
      selectOptions={{
        school_id: schoolIds,
        status: ["Enquiry", "Approved", "Admitted", "Rejected"],
      }}
      summaryKeys={["class", "section", "status"]}
      filterField="class"
      filterLabel="Class"
      renderDetail={(admission, helpers) => (
        <AdmissionProfile
          admission={admission}
          onConverted={() => {
            helpers.refresh();
            helpers.close();
          }}
        />
      )}
      addPanelFooter={
        <Link to="/students" className="directory-footer-link">
          View students →
        </Link>
      }
      fields={[
        { name: "name", label: "Name", required: true, placeholder: "Aarav Sharma" },
        { name: "school_id", label: "School", type: "select", required: true },
        { name: "class", label: "Class", required: true, placeholder: "10" },
        { name: "section", label: "Section", required: true, placeholder: "A" },
        { name: "admission_no", label: "Admission No.", placeholder: "AD-2026-001" },
        { name: "parent_name", label: "Parent Name", placeholder: "Rakesh Sharma" },
        { name: "parent_phone", label: "Parent Phone", placeholder: "9876500001" },
        { name: "status", label: "Status", type: "select" },
      ]}
      excel={{
        endpoint: "/upload/admissions",
        templateHint:
          "Columns: name, school_id, class, section, admission_no, parent_name, parent_phone, status (optional; admission_id is assigned automatically)",
        templateFile: "admissions_template.xlsx",
      }}
    />
  );
}
