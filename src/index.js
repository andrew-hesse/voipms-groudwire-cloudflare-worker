function debugLog(message, data = null, env = null) {
	if (env?.DEBUG === 'true') {
		const timestamp = new Date().toISOString();
		if (data) {
			console.log(`[DEBUG ${timestamp}] ${message}:`, JSON.stringify(data, null, 2));
		} else {
			console.log(`[DEBUG ${timestamp}] ${message}`);
		}
	}
}

async function getMyIpAddress(env = null) {
	try {
		debugLog('Fetching external IP address', null, env);
		const response = await fetch('https://ifconfig.me');
		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}
		const ipAddress = await response.text();
		debugLog('External IP address fetched', { ip: ipAddress.trim() }, env);
		return ipAddress.trim();
	} catch (error) {
		console.error('Error fetching IP address:', error);
		debugLog('Failed to fetch IP address', { error: error.message }, env);
		return 'unknown';
	}
}

function validateApiResponse(data) {
	if (!data || typeof data !== 'object') {
		throw new Error('Invalid API response format');
	}
	
	if (!data.status) {
		throw new Error('Missing status in API response');
	}
	
	return true;
}

async function getBalance(apiUsername, apiPassword, env = null) {
	if (!apiUsername || !apiPassword) {
		debugLog('Missing VoIP API credentials', { hasUsername: !!apiUsername, hasPassword: !!apiPassword }, env);
		throw new Error('Missing API credentials');
	}

	debugLog('Starting VoIP balance request', { username: apiUsername }, env);

	const method = 'getBalance';
	const encodedUsername = encodeURIComponent(apiUsername);
	const encodedPassword = encodeURIComponent(apiPassword);

	const voipMsApiURL = `https://voip.ms/api/v1/rest.php?content_type=json&api_username=${encodedUsername}&api_password=${encodedPassword}&method=${method}`;

	try {
		debugLog('Making VoIP API request', { url: voipMsApiURL.replace(/api_password=[^&]+/, 'api_password=***') }, env);
		const response = await fetch(voipMsApiURL, {
			method: 'GET',
			headers: {
				'User-Agent': 'Cloudflare-Worker/1.0'
			}
		});

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}

		const data = await response.json();
		debugLog('VoIP API response received', { status: data.status, hasBalance: !!data.balance }, env);
		validateApiResponse(data);

		if (data.status === 'success') {
			if (!data.balance || typeof data.balance.current_balance === 'undefined') {
				debugLog('Invalid balance data structure', { balance: data.balance }, env);
				throw new Error('Invalid balance data in API response');
			}
			const balance = parseFloat(data.balance.current_balance);
			if (isNaN(balance)) {
				debugLog('Invalid balance value', { rawBalance: data.balance.current_balance, parsedBalance: balance }, env);
				throw new Error('Invalid balance value received');
			}
			debugLog('Balance successfully retrieved', { balance: balance.toFixed(2) }, env);
			return balance.toFixed(2);
		} else if (data.status === 'ip_not_enabled') {
			debugLog('IP not enabled error from VoIP API', { status: data.status }, env);
			const ip = await getMyIpAddress(env);
			throw new Error(`IP not permitted by VOIP.MS. Source IP: ${ip}`);
		} else {
			const message = data.message || 'Unknown error';
			debugLog('VoIP API error', { status: data.status, message }, env);
			throw new Error(`${message} (${data.status})`);
		}
	} catch (error) {
		if (error.message.includes('IP not permitted') || error.message.includes('HTTP error')) {
			throw error;
		}
		throw new Error(`Failed to fetch balance: ${error.message}`);
	}
}

function validateUserAgent(userAgent) {
	if (!userAgent) {
		return false;
	}
	
	return userAgent.includes('Groundwire/') && 
		   userAgent.length < 200 && 
		   /^[a-zA-Z0-9\s\.\/\-_\(\);]+$/.test(userAgent);
}

function parseBearerToken(authHeader, env = null) {
	if (!authHeader) {
		debugLog('No authorization header provided by client', { authHeader: null }, env);
		return null;
	}
	
	if (!authHeader.startsWith('Bearer ')) {
		debugLog('Authorization header is not Bearer token', { 
			authHeader: authHeader,
			startsWithBearer: authHeader.startsWith('Bearer '),
			headerType: authHeader.split(' ')[0]
		}, env);
		return null;
	}
	
	const token = authHeader.slice(7).trim();
	if (!token) {
		debugLog('Empty Bearer token', null, env);
		return null;
	}
	
	debugLog('Bearer token parsed successfully', { tokenLength: token.length, tokenPreview: token.substring(0, 8) + '...' }, env);
	return token;
}

function validateAuthentication(authHeader, expectedToken, env = null) {
	if (!expectedToken) {
		debugLog('Authentication not required - no token configured', {
			hasExpectedToken: !!expectedToken
		}, env);
		return true;
	}
	
	debugLog('Authentication IS REQUIRED - server expects Bearer token', { 
		expectedTokenLength: expectedToken.length,
		expectedTokenPreview: expectedToken.substring(0, 8) + '...',
		clientProvidedAuthHeader: !!authHeader 
	}, env);
	
	if (!authHeader) {
		debugLog('❌ CLIENT ERROR: Groundwire must provide Authorization header with Bearer token', {
			requiredFormat: 'Authorization: Bearer <your-token>',
			exampleValue: `Authorization: Bearer ${expectedToken}`,
			configureIn: 'Groundwire Settings → Advanced → Web Services → Balance Checker → Custom Headers'
		}, env);
		return false;
	}
	
	const token = parseBearerToken(authHeader, env);
	if (!token) {
		debugLog('❌ AUTHENTICATION FAILED: Invalid authorization header format', null, env);
		return false;
	}
	
	const isValid = token === expectedToken;
					
	debugLog('Token validation result', { 
		providedTokenLength: token.length,
		providedTokenPreview: token.substring(0, 8) + '...',
		tokenMatch: isValid,
		isValid 
	}, env);
	
	return isValid;
}

function createErrorResponse(message, status = 500) {
	return new Response(
		JSON.stringify({ 
			error: true, 
			message,
			timestamp: new Date().toISOString()
		}),
		{
			status,
			headers: { 
				'Content-Type': 'application/json',
				'Cache-Control': 'no-cache, no-store, must-revalidate'
			}
		}
	);
}

function createSuccessResponse(balance, currency) {
	const response = {
		balanceString: `${currency} ${balance}`,
		balance: parseFloat(balance),
		currency,
		timestamp: new Date().toISOString()
	};
	
	return new Response(JSON.stringify(response), {
		headers: { 
			'Content-Type': 'application/json',
			'Cache-Control': 'no-cache, no-store, must-revalidate'
		}
	});
}

async function handleRequest(request, env) {
	const userAgent = request.headers.get('user-agent');
	const authHeader = request.headers.get('authorization');
	
	debugLog('📨 INCOMING REQUEST', { 
		userAgent, 
		hasAuthHeader: !!authHeader,
		authHeaderValue: authHeader ? authHeader.substring(0, 20) + '...' : null,
		method: request.method,
		url: request.url,
		allHeaders: Object.fromEntries(request.headers.entries())
	}, env);
	
	if (!validateUserAgent(userAgent)) {
		debugLog('User-agent validation failed', { userAgent }, env);
		return createErrorResponse('Unauthorized', 401);
	}
	
	debugLog('User-agent validation passed', null, env);

	try {
		const { 
			VOIP_USERNAME, 
			VOIP_PASSWORD, 
			CURRENCY = 'USD',
			TOKEN,
			DEBUG
		} = env;
		
		debugLog('Environment configuration', { 
			hasVoipUsername: !!VOIP_USERNAME,
			hasVoipPassword: !!VOIP_PASSWORD,
			currency: CURRENCY,
			hasToken: !!TOKEN,
			tokenLength: TOKEN ? TOKEN.length : 0,
			debugMode: DEBUG === 'true'
		}, env);
		
		if (!VOIP_USERNAME || !VOIP_PASSWORD) {
			debugLog('Missing VoIP configuration', { hasUsername: !!VOIP_USERNAME, hasPassword: !!VOIP_PASSWORD }, env);
			return createErrorResponse('Server configuration error', 500);
		}

		if (!validateAuthentication(authHeader, TOKEN, env)) {
			return createErrorResponse('Authentication required', 401);
		}

		debugLog('Starting balance retrieval', null, env);
		const balance = await getBalance(VOIP_USERNAME, VOIP_PASSWORD, env);
		debugLog('Balance retrieval completed successfully', { balance }, env);
		return createSuccessResponse(balance, CURRENCY);
		
	} catch (error) {
		console.error('Error in handleRequest:', error);
		debugLog('Request handling error', { 
			errorMessage: error.message,
			errorStack: error.stack,
			errorType: error.constructor.name
		}, env);
		
		if (error.message.includes('IP not permitted')) {
			debugLog('Returning IP permission error response', null, env);
			return createErrorResponse(error.message, 403);
		} else if (error.message.includes('Missing API credentials') || 
				   error.message.includes('Server configuration')) {
			debugLog('Returning configuration error response', null, env);
			return createErrorResponse('Configuration error', 500);
		} else if (error.message.includes('Invalid')) {
			debugLog('Returning invalid data error response', null, env);
			return createErrorResponse('Invalid data received from API', 502);
		} else {
			debugLog('Returning generic error response', null, env);
			return createErrorResponse('Service temporarily unavailable', 503);
		}
	}
}

export default {
	async fetch(request, env) {
		return handleRequest(request, env);
	}
};
