import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export function useSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    if (!socket) {
      // Use same origin in production, explicit URL in development
      // In dev: Vite runs on :5173, backend on :8000, so we need explicit URL
      // In prod: Use VITE_SOCKET_URL if set, otherwise window.location.origin
      const socketUrl = import.meta.env.DEV
        ? (import.meta.env.VITE_API_URL || 'http://localhost:8000')
        : (import.meta.env.VITE_SOCKET_URL || window.location.origin);

      socket = io(socketUrl, {
        transports: ['websocket', 'polling'],
        timeout: 10000,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
      });

      socket.on('connect', () => {
        console.log('Socket connected');
        setIsConnected(true);
        setConnectionStatus('connected');
        setConnectionError(null);
      });

      socket.on('disconnect', (reason) => {
        console.log('Socket disconnected:', reason);
        setIsConnected(false);
        setConnectionStatus('disconnected');
        if (reason === 'io server disconnect') {
          setConnectionError('Server hat die Verbindung getrennt');
        }
      });

      socket.on('connect_error', (error) => {
        console.error('Socket connection error:', error);
        setConnectionStatus('error');
        setConnectionError(
          'Verbindung zum Server fehlgeschlagen. Bitte prüfen Sie Ihre Firewall-Einstellungen oder Netzwerkverbindung.'
        );
      });

      socket.on('reconnect_attempt', (attemptNumber) => {
        console.log('Socket reconnection attempt:', attemptNumber);
        setConnectionStatus('connecting');
      });

      socket.on('reconnect_failed', () => {
        console.error('Socket reconnection failed');
        setConnectionStatus('error');
        setConnectionError(
          'Verbindung konnte nicht wiederhergestellt werden. Bitte laden Sie die Seite neu.'
        );
      });
    }

    return () => {
      // Don't disconnect on component unmount, keep connection alive
    };
  }, []);

  return { socket, isConnected, connectionStatus, connectionError };
}

export function getSocket(): Socket | null {
  return socket;
}
