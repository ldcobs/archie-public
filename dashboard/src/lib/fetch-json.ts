'use client';

import { apiUrl } from './api-path';

function redirectTo(path: string) {
  if (typeof window !== 'undefined' && window.location.pathname !== path) {
    window.location.assign(path);
  }
}

function redirectForAuthFailure(status: number) {
  if (status === 401) redirectTo(apiUrl('/login'));
  if (status === 503) redirectTo(apiUrl('/setup'));
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (response.status === 401 || response.status === 503) {
    redirectForAuthFailure(response.status);
  }

  const text = await response.text();
  const contentType = response.headers.get('content-type') ?? '';

  if (!contentType.includes('application/json')) {
    const finalPath = response.url ? new URL(response.url).pathname : '';
    if (response.redirected && (finalPath.endsWith('/login') || finalPath.endsWith('/setup'))) {
      redirectTo(finalPath);
    }
    if (/<!doctype html/i.test(text)) {
      throw new Error('Authentication required');
    }
    throw new Error(`Expected JSON response from ${url}`);
  }

  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(body?.error ?? `Request failed (${response.status})`);
  }
  return body as T;
}
