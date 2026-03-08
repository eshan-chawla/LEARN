'use client';

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';

export default function SignUpForm() {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    givenName: '',
    familyName: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmationCode, setConfirmationCode] = useState('');
  const { signUp, confirmSignUp } = useAuth();
  const router = useRouter();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }

    setLoading(true);

    const result = await signUp(
      formData.email,
      formData.password,
      formData.givenName,
      formData.familyName
    );

    setLoading(false);

    if (result.success) {
      setShowConfirmation(true);
    } else {
      setError(result.error || 'Sign up failed');
    }
  };

  const handleConfirmation = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await confirmSignUp(formData.email, confirmationCode);

    setLoading(false);

    if (result.success) {
      router.push('/signin');
    } else {
      setError(result.error || 'Confirmation failed');
    }
  };

  if (showConfirmation) {
    return (
      <div className="max-w-md mx-auto mt-8 p-6 bg-white rounded-lg shadow-md">
        <h2 className="text-2xl font-bold mb-4">Confirm Your Email</h2>
        <p className="mb-4 text-gray-600">
          We've sent a confirmation code to {formData.email}. Please enter it below.
        </p>
        <form onSubmit={handleConfirmation} className="space-y-4">
          <div>
            <label htmlFor="code" className="block text-sm font-medium text-gray-700">
              Confirmation Code
            </label>
            <input
              type="text"
              id="code"
              value={confirmationCode}
              onChange={(e) => setConfirmationCode(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              required
            />
          </div>
          {error && (
            <div className="text-red-500 text-sm">{error}</div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
          >
            {loading ? 'Confirming...' : 'Confirm Email'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto mt-8 p-6 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold mb-4">Sign Up</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700">
            Email
          </label>
          <input
            type="email"
            id="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            required
          />
        </div>
        <div>
          <label htmlFor="givenName" className="block text-sm font-medium text-gray-700">
            First Name
          </label>
          <input
            type="text"
            id="givenName"
            name="givenName"
            value={formData.givenName}
            onChange={handleChange}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div>
          <label htmlFor="familyName" className="block text-sm font-medium text-gray-700">
            Last Name
          </label>
          <input
            type="text"
            id="familyName"
            name="familyName"
            value={formData.familyName}
            onChange={handleChange}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700">
            Password
          </label>
          <input
            type="password"
            id="password"
            name="password"
            value={formData.password}
            onChange={handleChange}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            required
          />
        </div>
        <div>
          <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700">
            Confirm Password
          </label>
          <input
            type="password"
            id="confirmPassword"
            name="confirmPassword"
            value={formData.confirmPassword}
            onChange={handleChange}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            required
          />
        </div>
        {error && (
          <div className="text-red-500 text-sm">{error}</div>
        )}
        <button
          type="submit"
          disabled={loading}
          className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
        >
          {loading ? 'Signing Up...' : 'Sign Up'}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-gray-600">
        Already have an account?{' '}
        <a href="/signin" className="text-blue-600 hover:text-blue-500">
          Sign In
        </a>
      </p>
    </div>
  );
}