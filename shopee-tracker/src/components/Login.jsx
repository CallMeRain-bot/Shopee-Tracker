/**
 * Login Component
 * Secure authentication form with Supabase
 */

import { useState } from 'react';
import { signIn } from '../services/supabase';

function Login({ onLoginSuccess }) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        // Basic validation
        if (!email || !password) {
            setError('Vui lòng nhập email và mật khẩu');
            setLoading(false);
            return;
        }

        // Email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            setError('Email không hợp lệ');
            setLoading(false);
            return;
        }

        try {
            const { user, error: authError } = await signIn(email, password);

            if (authError) {
                // Map error messages
                if (authError.message.includes('Invalid login')) {
                    setError('Email hoặc mật khẩu không đúng');
                } else if (authError.message.includes('Email not confirmed')) {
                    setError('Email chưa được xác nhận');
                } else {
                    setError('Đăng nhập thất bại. Vui lòng thử lại.');
                }
                console.error('Auth error:', authError);
                setLoading(false);
                return;
            }

            if (user) {
                onLoginSuccess(user);
            }
        } catch (err) {
            setError('Lỗi kết nối. Vui lòng thử lại.');
            console.error('Login error:', err);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-container">
            <div className="login-card">
                <div className="login-header">
                    <div className="login-icon">
                        <span className="material-symbols-outlined">shopping_cart</span>
                    </div>
                    <h1>Shopee Tracker</h1>
                    <p>Đăng nhập để tiếp tục</p>
                </div>

                <form onSubmit={handleSubmit} className="login-form">
                    {error && (
                        <div className="login-error">
                            <span className="material-symbols-outlined">error</span>
                            <span>{error}</span>
                        </div>
                    )}

                    <div className="form-group">
                        <label htmlFor="email">Email</label>
                        <input
                            type="email"
                            id="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="your@email.com"
                            disabled={loading}
                            autoComplete="email"
                            autoFocus
                        />
                    </div>

                    <div className="form-group">
                        <label htmlFor="password">Mật khẩu</label>
                        <input
                            type="password"
                            id="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            disabled={loading}
                            autoComplete="current-password"
                        />
                    </div>

                    <button
                        type="submit"
                        className="btn btn-primary login-btn"
                        disabled={loading}
                    >
                        {loading ? (
                            <>
                                <span className="spinner"></span>
                                Đang đăng nhập...
                            </>
                        ) : (
                            <>
                                <span className="material-symbols-outlined">login</span>
                                Đăng nhập
                            </>
                        )}
                    </button>
                </form>

                <div className="login-footer">
                    <p>Shopee Order Tracking System</p>
                </div>
            </div>
        </div>
    );
}

export default Login;
