import { Request, Response, NextFunction } from 'express';

export function authenticate(req: Request, res: Response, next: NextFunction) {
  // Support password from body (POST) or Authorization header (GET/DELETE)
  // Never use query params for passwords!
  const password = req.body.password || req.headers['x-dozent-password'];

  if (password !== process.env.DOZENT_PASSWORD) {
    return res.status(401).json({ error: 'Falsches Passwort' });
  }

  next();
}
