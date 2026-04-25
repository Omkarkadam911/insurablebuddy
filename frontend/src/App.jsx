import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import './App.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/chat';
const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

// Generate a unique session ID once per browser and persist it across refreshes
function getSessionId() {
  let id = localStorage.getItem('chat_session_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('chat_session_id', id);
  }
  return id;
}
const sessionId = getSessionId();

function App() {
  const [messages, setMessages] = useState([
    {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: 'Hi! I\'m Insurable Buddy. How can I help you with insurance today?',
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async (e) => {
    e.preventDefault();

    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');

    // Add user message to chat
    const newMessages = [...messages, { id: crypto.randomUUID(), role: 'user', content: userMessage }];
    setMessages(newMessages);
    setIsLoading(true);

    try {
      // Prepare conversation history (last 10 messages for context)
      const conversationHistory = messages.slice(-10).map(msg => ({
        role: msg.role,
        content: msg.content,
      }));

      // Send to backend
      const response = await axios.post(`${API_URL}/message`, {
        message: userMessage,
        conversationHistory,
        userTimezone,
        sessionId,
      });

      // Add assistant response
      setMessages([
        ...newMessages,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: response.data.message,
          sources: response.data.sources,
        },
      ]);
    } catch (error) {
      console.error('Error sending message:', error);
      setMessages([
        ...newMessages,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: 'Sorry, I encountered an error. Please try again.',
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="app">
      <div className="chat-container">
        <div className="chat-header">
          <h1>Insurable Buddy</h1>
        </div>

        <div className="messages-container">
          {messages.map((msg) => (
            <div key={msg.id} className={`message ${msg.role}`}>
              <div className="message-avatar">
                {msg.role === 'assistant' ? '🤖' : '👤'}
              </div>
              <div className="message-content">
                <ReactMarkdown>{msg.content}</ReactMarkdown>
                {msg.sources && msg.sources.length > 0 && (
                  <div className="sources">
                    <small>Sources: {msg.sources.slice(0, 3).map((src, i) => (
                      src.startsWith('http')
                        ? <a key={i} href={src} target="_blank" rel="noopener noreferrer">{new URL(src).hostname}</a>
                        : <span key={i}>{src}</span>
                    )).reduce((prev, curr, i) => [prev, <span key={`sep-${i}`}>, </span>, curr])}
                    </small>
                  </div>
                )}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="message assistant">
              <div className="message-avatar">🤖</div>
              <div className="message-content">
                <div className="typing-indicator">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <form className="input-container" onSubmit={sendMessage}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message..."
            disabled={isLoading}
          />
          <button type="submit" disabled={isLoading || !input.trim()}>
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

export default App;
