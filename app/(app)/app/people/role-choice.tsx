import { invitableRoles, roleAbout, roleLabel } from "@/src/lib/roles";

// The roles an owner can give, each with one line on what it is, as a choice of cards.
export function RoleChoice({ name = "role", value = "staff", label = "Role" }: { name?: string; value?: string; label?: string }) {
  return (
    <fieldset className="role-pick">
      <legend>{label}</legend>
      {invitableRoles.map((role) => (
        <label key={role}>
          <input type="radio" name={name} value={role} defaultChecked={role === value} />
          <span>
            <strong>{roleLabel(role)}</strong>
            <small>{roleAbout[role]}</small>
          </span>
        </label>
      ))}
      <p className="hint">What each role may do exactly is yours to change in Settings, Permissions.</p>
    </fieldset>
  );
}
