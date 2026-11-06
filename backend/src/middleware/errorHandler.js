export class AppError extends Error {
    constructor(message, statusCode = 500) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true;
    }
}

export const errorHandler = (err, _req, res, _next) => {
    const statusCode = err.statusCode || 500;
    const message = err.isOperational ? err.message : 'Internal server error';
    if (!err.isOperational) console.error('[ERROR]', err);
    res.status(statusCode).json({
        success: false,
        error: message,
        timestamp: new Date().toISOString(),
    });
};