'use client';

type Status = 'ready' | 'submitted' | 'streaming' | 'error';

export function ChatInput({
  input,
  setInput,
  onSend,
  isLoading,
  status = 'ready',
}: {
  input: string;
  setInput: (value: string) => void;
  onSend: (content: string) => void;
  isLoading: boolean;
  status?: Status;
}) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || status !== 'ready') return;
    onSend(trimmed);
  };

  return (
    <div className="border-t border-gray-200 bg-white px-4 py-4">
      <form onSubmit={handleSubmit} className="mx-auto max-w-3xl">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 rounded-lg border border-gray-300 px-4 py-3 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            disabled={status !== 'ready'}
          />
          <button
            type="submit"
            disabled={!input.trim() || status !== 'ready'}
            className="rounded-lg bg-blue-600 px-5 py-3 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
}
