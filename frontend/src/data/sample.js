// Placeholder records shown when Firestore is empty or unreachable, so the
// grid always has something to render during the first draft.
// Field names match the Excel templates in public/templates/.

const students = [
  ["Chavi Rana", "F", "Vaibhav Rana", "2", "A", "paid"],
  ["Aarav Sharma", "M", "Rakesh Sharma", "2", "A", "due"],
  ["Ishita Verma", "F", "Sunil Verma", "3", "B", "paid"],
  ["Kabir Singh", "M", "Harpreet Singh", "1", "A", "paid"],
  ["Ananya Gupta", "F", "Manoj Gupta", "4", "A", "overdue"],
  ["Myra Chauhan", "F", "Deepak Chauhan", "1", "B", "paid"],
  ["Vihaan Mehta", "M", "Alok Mehta", "5", "A", "due"],
  ["Saanvi Joshi", "F", "Prakash Joshi", "2", "B", "paid"],
  ["Arjun Negi", "M", "Rajesh Negi", "3", "A", "paid"],
  ["Diya Thakur", "F", "Vikram Thakur", "4", "B", "paid"],
  ["Reyansh Bisht", "M", "Naveen Bisht", "5", "B", "overdue"],
  ["Kiara Rawat", "F", "Sandeep Rawat", "1", "A", "paid"],
].map(([name, gender, parent_name, klass, section, fee_status], i) => ({
  id: `sample-s${i}`,
  name,
  gender,
  parent_name,
  class: klass,
  section,
  admission_no: `2K24-${1093 + i}`,
  fee_status,
  photo_url: "",
}));

const employees = [
  ["Meena Gupta", "Teacher", "Mathematics"],
  ["Rohit Kumar", "Teacher", "Science"],
  ["Pooja Saini", "Coordinator", "Primary Wing"],
  ["Anil Rawat", "Driver", "Transport"],
  ["Sunita Devi", "Accountant", "Accounts"],
  ["Rahul Pundir", "Teacher", "English"],
  ["Kavita Bhatt", "Librarian", "Library"],
  ["Mohan Lal", "Peon", "Administration"],
].map(([name, designation, department], i) => ({
  id: `sample-e${i}`,
  name,
  designation,
  department,
  employee_no: `EMP-${201 + i}`,
  photo_url: "",
}));

export const SAMPLE = { students, employees };
