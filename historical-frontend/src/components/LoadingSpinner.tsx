interface LoadingSpinnerProps {
  message?: string;
}

export default function LoadingSpinner({ message }: LoadingSpinnerProps) {
  return (
    <div className="spinner-container">
      <div className="spinner" />
      {message && <p className="spinner-message">{message}</p>}
    </div>
  );
}
