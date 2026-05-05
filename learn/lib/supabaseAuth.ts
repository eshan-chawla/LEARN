const INVALID_REFRESH_TOKEN_MESSAGES = ['Invalid Refresh Token', 'Refresh Token Not Found'];

export function getErrorMessage(error: unknown): string {
  if (!error) {
    return '';
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }

  return '';
}

function getErrorCode(error: unknown): string {
  if (typeof error === 'object' && error && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }

  return '';
}

export function isInvalidRefreshTokenError(error: unknown): boolean {
  const message = getErrorMessage(error);
  const code = getErrorCode(error);

  return INVALID_REFRESH_TOKEN_MESSAGES.some((pattern) => message.includes(pattern)) || code === 'refresh_token_not_found';
}
