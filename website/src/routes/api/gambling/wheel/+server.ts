import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { authenticate } from '$lib/server/auth';
// import { wheelOfFortuneSpin } from '$lib/server/db/schema'; // Will use this later

export const POST: RequestHandler = async ({ request, locals }) => {
	const auth = await authenticate(locals, request);
	if (!auth.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = await request.json();
	const { betAmount } = body;

	if (!betAmount || typeof betAmount !== 'number' || betAmount <= 0) {
		return json({ error: 'Invalid bet amount' }, { status: 400 });
	}

	// TODO: Check user balance
	// TODO: Implement wheel spinning logic (determine segments, probabilities, outcome)
	// TODO: Deduct betAmount from user balance
	// TODO: Record spin in wheelOfFortuneSpin table
	// TODO: Add winnings to user balance if any
	// TODO: Return spin result (segment landed on, multiplier, payout)

	const placeholderResult = {
		segmentLandedOn: '2x',
		multiplierWon: 2,
		payoutAmount: betAmount * 2,
		newBalance: 1000 // Placeholder
	};

	return json(placeholderResult);
};
