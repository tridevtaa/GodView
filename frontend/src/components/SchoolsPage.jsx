import React from "react";
import DirectoryPage from "./DirectoryPage.jsx";

export default function SchoolsPage() {
  return (
    <DirectoryPage
      title="Schools"
      singularLabel="School"
      collection="schools"
      addEndpoint="/schools/add"
      summaryKeys={["lat", "lng"]}
      fields={[
        { name: "name", label: "Name", required: true, placeholder: "Green Valley School" },
        { name: "lat", label: "Latitude", type: "number", required: true, placeholder: "28.4595" },
        { name: "lng", label: "Longitude", type: "number", required: true, placeholder: "77.0266" },
      ]}
      excel={{
        endpoint: "/upload/schools",
        templateHint: "Columns: name, lat, lng (school_id is assigned automatically)",
        templateFile: "schools_template.xlsx",
      }}
    />
  );
}
