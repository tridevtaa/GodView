// Student records with something missing: the Students list's "Show only"
// filter and Home use the same checks. doc: a document still to collect
// (Home counts those as pending documents, the rest as gaps in records).
export const NEEDS = {
  photo: { label: "No photo", title: "Students without a photo", test: (p) => !(p.photo_path || p.photo_url) },
  phone: { label: "No parent phone", title: "No parent phone", test: (p) => !(p.parent_phone || p.father_phone || p.mother_phone) },
  aadhaar: { label: "No Aadhaar", title: "No Aadhaar", test: (p) => !p.aadhaar },
  stop: { label: "On the bus, no stop", title: "On the bus without a stop", test: (p) => Boolean(p.uses_bus && !p.bus_stop_id) },
  slc: { label: "SLC pending", title: "SLC pending", test: (p) => Boolean(p.transfer_cert_pending), doc: true },
  aadhaarDoc: { label: "No Aadhaar card", title: "No Aadhaar card uploaded", test: (p) => !p.aadhaar_doc_path, doc: true },
  birthCert: { label: "No birth certificate", title: "No birth certificate uploaded", test: (p) => !p.birth_cert_path, doc: true },
};
