// The numbered bar for forms split into steps. steps: labels. marks: steps
// to flag with a dot (e.g. changed). canPick(i): whether a step can be
// opened directly (new records: only steps already reachable).
export function StepBar({ steps, step, onPick, marks = [], canPick = () => true }) {
  return (
    <nav className="edit-steps" aria-label="Steps">
      {steps.map((label, i) => (
        <button
          type="button"
          key={label}
          className={`${i === step ? "is-on" : ""}${i < step ? " is-done" : ""}`}
          aria-current={i === step ? "step" : undefined}
          disabled={i !== step && !canPick(i)}
          onClick={() => onPick(i)}
        >
          <span className="edit-step-n">{i + 1}</span>
          <span className="edit-step-label">{label}</span>
          {marks[i] && <span className="edit-step-dot" aria-label="changed" />}
        </button>
      ))}
    </nav>
  );
}
