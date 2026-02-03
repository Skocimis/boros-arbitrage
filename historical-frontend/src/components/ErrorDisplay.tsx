interface ErrorDisplayProps {
  message: string | null;
}

export default function ErrorDisplay({ message }: ErrorDisplayProps) {
  if (!message) return null;

  return (
    <div className="error-section">
      <p className="error-message">{message}</p>
    </div>
  );
}
