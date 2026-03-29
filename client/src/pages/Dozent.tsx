import { useState, useEffect } from 'react';
import { DozentPanel } from '../components/dozent/DozentPanel';
import { PasswordPrompt } from '../components/dozent/PasswordPrompt';

export function Dozent() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const savedPassword = localStorage.getItem('dozent-password');
    if (savedPassword) {
      setIsAuthenticated(true);
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('dozent-password');
    setIsAuthenticated(false);
  };

  if (!isAuthenticated) {
    return <PasswordPrompt onAuthenticated={() => setIsAuthenticated(true)} />;
  }

  return <DozentPanel onLogout={handleLogout} />;
}
