import { Icon } from "../components/icon";

export function IssueList({ messages }: { readonly messages: readonly string[] }) {
  if (messages.length === 0) return null;
  return (
    <ul className="form-issues" aria-label="Validation issues">
      {messages.map((message) => (
        <li key={message}>
          <Icon name="warning" size={14} />
          <span>{message}</span>
        </li>
      ))}
    </ul>
  );
}
