import { expect, test, describe, beforeEach } from 'vitest';
import worker from './index.js';

describe('VoIP Balance Checker Worker', () => {
	let env;
	
	beforeEach(() => {
		env = {
			VOIP_USERNAME: 'test_user@example.com',
			VOIP_PASSWORD: 'test_password',
			CURRENCY: 'CAD',
			TOKEN: '123',
			DEBUG: 'false'
		};
	});

	test('should reject requests without Groundwire user agent', async () => {
		const request = new Request('https://example.com', {
			headers: { 
				'User-Agent': 'Mozilla/5.0',
				'Authorization': 'Bearer 123'
			}
		});

		const response = await worker.fetch(request, env);
		const data = await response.json();

		expect(response.status).toBe(401);
		expect(data.error).toBe(true);
		expect(data.message).toBe('Unauthorized');
	});

	test('should accept requests with Groundwire user agent and valid token', async () => {
		const request = new Request('https://example.com', {
			headers: { 
				'User-Agent': 'Groundwire/1.0',
				'Authorization': 'Bearer 123'
			}
		});

		global.fetch = async (url) => {
			if (url.includes('voip.ms')) {
				return new Response(JSON.stringify({
					status: 'success',
					balance: { current_balance: '12.34' }
				}));
			}
			throw new Error('Unexpected fetch call');
		};

		const response = await worker.fetch(request, env);
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data.balanceString).toBe('CAD 12.34');
		expect(data.balance).toBe(12.34);
		expect(data.currency).toBe('CAD');
	});

	test('should handle missing VoIP credentials', async () => {
		const request = new Request('https://example.com', {
			headers: { 
				'User-Agent': 'Groundwire/1.0',
				'Authorization': 'Bearer 123'
			}
		});

		const envWithoutCreds = { CURRENCY: 'CAD' };
		const response = await worker.fetch(request, envWithoutCreds);
		const data = await response.json();

		expect(response.status).toBe(500);
		expect(data.error).toBe(true);
		expect(data.message).toBe('Server configuration error');
	});

	test('should handle IP not enabled error', async () => {
		const request = new Request('https://example.com', {
			headers: { 
				'User-Agent': 'Groundwire/1.0',
				'Authorization': 'Bearer 123'
			}
		});

		global.fetch = async (url) => {
			if (url.includes('voip.ms')) {
				return new Response(JSON.stringify({
					status: 'ip_not_enabled',
					message: 'IP not enabled'
				}));
			}
			if (url.includes('ifconfig.me')) {
				return new Response('1.2.3.4');
			}
			throw new Error('Unexpected fetch call');
		};

		const response = await worker.fetch(request, env);
		const data = await response.json();

		expect(response.status).toBe(403);
		expect(data.error).toBe(true);
		expect(data.message).toContain('IP not permitted by VOIP.MS');
	});

	test('should handle invalid balance data', async () => {
		const request = new Request('https://example.com', {
			headers: { 
				'User-Agent': 'Groundwire/1.0',
				'Authorization': 'Bearer 123'
			}
		});

		global.fetch = async (url) => {
			if (url.includes('voip.ms')) {
				return new Response(JSON.stringify({
					status: 'success',
					balance: { current_balance: 'invalid' }
				}));
			}
			throw new Error('Unexpected fetch call');
		};

		const response = await worker.fetch(request, env);
		const data = await response.json();

		expect(response.status).toBe(502);
		expect(data.error).toBe(true);
		expect(data.message).toBe('Invalid data received from API');
	});

	test('should validate user agent format', async () => {
		const maliciousRequest = new Request('https://example.com', {
			headers: { 'User-Agent': 'Groundwire/<script>alert("xss")</script>' }
		});

		const response = await worker.fetch(maliciousRequest, env);
		const data = await response.json();

		expect(response.status).toBe(401);
		expect(data.error).toBe(true);
		expect(data.message).toBe('Unauthorized');
	});

	test('should reject requests without Bearer token when required', async () => {
		const request = new Request('https://example.com', {
			headers: { 'User-Agent': 'Groundwire/1.0' }
		});

		const response = await worker.fetch(request, env);
		const data = await response.json();

		expect(response.status).toBe(401);
		expect(data.error).toBe(true);
		expect(data.message).toBe('Authentication required');
	});

	test('should reject requests with invalid Bearer token', async () => {
		const request = new Request('https://example.com', {
			headers: { 
				'User-Agent': 'Groundwire/1.0',
				'Authorization': 'Bearer wrong-token'
			}
		});

		const response = await worker.fetch(request, env);
		const data = await response.json();

		expect(response.status).toBe(401);
		expect(data.error).toBe(true);
		expect(data.message).toBe('Authentication required');
	});

	test('should work without authentication when token not configured', async () => {
		const envNoAuth = {
			VOIP_USERNAME: 'test_user@example.com',
			VOIP_PASSWORD: 'test_password',
			CURRENCY: 'CAD'
		};

		const request = new Request('https://example.com', {
			headers: { 'User-Agent': 'Groundwire/1.0' }
		});

		global.fetch = async (url) => {
			if (url.includes('voip.ms')) {
				return new Response(JSON.stringify({
					status: 'success',
					balance: { current_balance: '15.67' }
				}));
			}
			throw new Error('Unexpected fetch call');
		};

		const response = await worker.fetch(request, envNoAuth);
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data.balanceString).toBe('CAD 15.67');
	});

	test('should handle malformed authorization header', async () => {
		const request = new Request('https://example.com', {
			headers: { 
				'User-Agent': 'Groundwire/1.0',
				'Authorization': 'Basic invalid-format'
			}
		});

		const response = await worker.fetch(request, env);
		const data = await response.json();

		expect(response.status).toBe(401);
		expect(data.error).toBe(true);
		expect(data.message).toBe('Authentication required');
	});

	test('should provide detailed debug logging when DEBUG is enabled', async () => {
		const envWithDebug = { ...env, DEBUG: 'true' };
		const request = new Request('https://example.com', {
			headers: { 
				'User-Agent': 'Groundwire/1.0',
				'Authorization': 'Bearer 123'
			}
		});

		const originalConsoleLog = console.log;
		const logs = [];
		console.log = (...args) => logs.push(args.join(' '));

		global.fetch = async (url) => {
			if (url.includes('voip.ms')) {
				return new Response(JSON.stringify({
					status: 'success',
					balance: { current_balance: '25.50' }
				}));
			}
			throw new Error('Unexpected fetch call');
		};

		const response = await worker.fetch(request, envWithDebug);
		console.log = originalConsoleLog;

		expect(response.status).toBe(200);
		expect(logs.some(log => log.includes('[DEBUG') && log.includes('INCOMING REQUEST'))).toBe(true);
		expect(logs.some(log => log.includes('[DEBUG') && log.includes('Environment configuration'))).toBe(true);
		expect(logs.some(log => log.includes('[DEBUG') && log.includes('Authentication IS REQUIRED'))).toBe(true);
		expect(logs.some(log => log.includes('[DEBUG') && log.includes('Balance successfully retrieved'))).toBe(true);
	});

	test('should not log debug messages when DEBUG is disabled', async () => {
		const request = new Request('https://example.com', {
			headers: { 
				'User-Agent': 'Groundwire/1.0',
				'Authorization': 'Bearer 123'
			}
		});

		const originalConsoleLog = console.log;
		const logs = [];
		console.log = (...args) => logs.push(args.join(' '));

		global.fetch = async (url) => {
			if (url.includes('voip.ms')) {
				return new Response(JSON.stringify({
					status: 'success',
					balance: { current_balance: '30.25' }
				}));
			}
			throw new Error('Unexpected fetch call');
		};

		const response = await worker.fetch(request, env);
		console.log = originalConsoleLog;

		expect(response.status).toBe(200);
		expect(logs.some(log => log.includes('[DEBUG'))).toBe(false);
	});

	test('should accept real Groundwire user agent with build info', async () => {
		const request = new Request('https://example.com', {
			headers: { 
				'User-Agent': 'Groundwire/25.2.34 (build 2335157; iOS 18.6.2; arm64-neon)',
				'Authorization': 'Bearer 123'
			}
		});

		global.fetch = async (url) => {
			if (url.includes('voip.ms')) {
				return new Response(JSON.stringify({
					status: 'success',
					balance: { current_balance: '42.50' }
				}));
			}
			throw new Error('Unexpected fetch call');
		};

		const response = await worker.fetch(request, env);
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data.balanceString).toBe('CAD 42.50');
		expect(data.balance).toBe(42.50);
		expect(data.currency).toBe('CAD');
	});
});