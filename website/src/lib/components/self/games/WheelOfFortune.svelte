<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { toast } from 'svelte-sonner';
	import { CircleDollarSign, Loader2, RotateCw } from 'lucide-svelte';
	import { sineInOut } from 'svelte/easing';
	import { tweened } from 'svelte/motion';
	import { formatValue, playSound, showConfetti } from '$lib/utils';
	import { volumeSettings } from '$lib/stores/volume-settings';
	import { onMount } from 'svelte';
	import confetti from 'canvas-confetti';

	let { balance = $bindable(), onBalanceUpdate } = $props<{
		balance: number;
		onBalanceUpdate: (newBalance: number) => void;
	}>();

	const MAX_BET_AMOUNT = 1000000;

	const segments = [
		{ label: '1.5x', value: 1.5, color: 'bg-green-500', textColor: 'text-white' },
		{ label: '0.2x', value: 0.2, color: 'bg-red-700', textColor: 'text-white' },
		{ label: '1.2x', value: 1.2, color: 'bg-blue-500', textColor: 'text-white' },
		{ label: 'Lose', value: 0, color: 'bg-gray-600', textColor: 'text-white' },
		{ label: '2x', value: 2, color: 'bg-yellow-500', textColor: 'text-black' },
		{ label: '0.5x', value: 0.5, color: 'bg-red-500', textColor: 'text-white' },
		{ label: '3x', value: 3, color: 'bg-purple-500', textColor: 'text-white' },
		{ label: 'Jackpot 10x', value: 10, color: 'bg-orange-500', textColor: 'text-white' }
	];
	const numSegments = segments.length;
	const segmentAngle = 360 / numSegments;

	let betAmount = $state(10);
	let betAmountDisplay = $state(betAmount.toLocaleString());
	let spinning = $state(false);
	let resultMessage = $state('');
	let resultType: 'success' | 'error' | 'info' = $state('info');

	const rotation = tweened(0, {
		duration: 4000,
		easing: sineInOut
	});

	function handleBetAmountInput(event: Event) {
		const target = event.target as HTMLInputElement;
		const value = target.value.replace(/,/g, '');
		const numValue = parseFloat(value) || 0;
		betAmount = Math.max(0, Math.min(numValue, Math.min(balance, MAX_BET_AMOUNT)));
		betAmountDisplay = target.value;
	}

	function handleBetAmountBlur() {
		betAmountDisplay = betAmount.toLocaleString();
	}

	function setBetPercentage(percentage: number) {
		const amount = Math.floor(Math.min(balance, MAX_BET_AMOUNT) * percentage);
		betAmount = amount;
		betAmountDisplay = amount.toLocaleString();
	}

	async function spinWheel() {
		if (spinning) return;
		if (betAmount <= 0) {
			toast.error('Bet amount must be greater than 0.');
			return;
		}
		if (betAmount > balance) {
			toast.error('Insufficient balance.');
			return;
		}

		spinning = true;
		resultMessage = '';
		playSound('click');

		try {
			const response = await fetch('/api/gambling/wheel', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ betAmount })
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error || `Server error: ${response.status}`);
			}

			const gameResult: {
				segmentLandedOn: string;
				multiplierWon: number;
				payoutAmount: number;
				newBalance: number;
			} = await response.json();

			playSound('dice'); // Using 'dice' as a placeholder for wheel spin sound

			let targetSegmentIndex = segments.findIndex(s => s.value === gameResult.multiplierWon && s.label === gameResult.segmentLandedOn);
            if (targetSegmentIndex === -1) {
                targetSegmentIndex = segments.findIndex(s => s.value === gameResult.multiplierWon);
            }
			if (targetSegmentIndex === -1) targetSegmentIndex = 0;

			const randomSpins = 3 + Math.floor(Math.random() * 3);
			const targetRotation = randomSpins * 360 - targetSegmentIndex * segmentAngle - segmentAngle / 2;

			const currentRotationValue = $rotation;
			let adjustedTargetRotation = targetRotation;
			if (targetRotation < currentRotationValue) {
				adjustedTargetRotation += Math.ceil((currentRotationValue - targetRotation) / 360) * 360;
			}

			await rotation.set(adjustedTargetRotation);
			// Consider adding a sound for when the wheel stops, before result.

			onBalanceUpdate(gameResult.newBalance);

			if (gameResult.payoutAmount > 0 && gameResult.multiplierWon > 0) {
				resultMessage = `Congratulations! You won ${formatValue(gameResult.payoutAmount)} (x${gameResult.multiplierWon})!`;
				resultType = 'success';
				toast.success(resultMessage);
				playSound('win');
				if (gameResult.multiplierWon >= 5) {
					showConfetti(confetti);
				}
			} else if (gameResult.multiplierWon === 0) { // Explicitly a "Lose" segment
				resultMessage = `So close! Landed on ${gameResult.segmentLandedOn}. Better luck next time!`;
				resultType = 'info'; // Could be 'error' or 'info' based on preference
				toast.info(resultMessage); // Or toast.error
				playSound('lose');
			} else { // Other non-winning scenarios, e.g., very low multiplier like 0.2x
				resultMessage = `Spin resulted in ${gameResult.segmentLandedOn}. You received ${formatValue(gameResult.payoutAmount)}.`;
				resultType = 'info';
				toast.info(resultMessage);
				// playSound('lose'); // Or a neutral sound if payout > 0 but < bet
			}

		} catch (error) {
			console.error('Spin error:', error);
			const errorMessage = error instanceof Error ? error.message : 'Spin failed. Please try again.';
			resultMessage = errorMessage;
			resultType = 'error';
			toast.error(errorMessage);
			playSound('lose');
		} finally {
			spinning = false;
		}
	}

	function getSegmentTransform(index: number): string {
		const angle = index * segmentAngle;
		return `rotate(${angle}deg) skewY(${90 - segmentAngle}deg)`;
	}

	function getSegmentLabelTransform(index: number): string {
		const angle = segmentAngle / 2;
		return `skewY(-${90 - segmentAngle}deg) rotate(${angle}deg) translateY(-140%)`;
	}

	onMount(() => {
		volumeSettings.load();
	});

</script>

<Card>
	<CardHeader>
		<CardTitle>Wheel of Fortune</CardTitle>
		<CardDescription>Spin the wheel for a chance to multiply your bet!</CardDescription>
	</CardHeader>
	<CardContent class="flex flex-col items-center gap-6">
		<!-- Balance Display -->
		<div class="text-center">
			<p class="text-muted-foreground text-sm">Balance</p>
			<p class="text-2xl font-bold">{formatValue(balance)}</p>
		</div>

		<div class="relative my-4 flex h-80 w-80 items-center justify-center rounded-full border-4 border-primary shadow-2xl md:h-96 md:w-96">
			<div class="absolute -top-3 z-10 h-0 w-0 border-x-8 border-b-[16px] border-x-transparent border-b-destructive" style="left: calc(50% - 8px);"></div>
			<div
				class="absolute h-full w-full transform-gpu rounded-full transition-transform duration-[4000ms]"
				style="transform: rotate({$rotation}deg);"
			>
				{#each segments as segment, i}
					<div
						class="absolute left-0 top-0 h-1/2 w-1/2 origin-bottom-right transform-gpu overflow-hidden {segment.color}"
						style="transform: {getSegmentTransform(i)};"
					>
						<span
							class="absolute block w-[200%] text-center text-sm font-semibold {segment.textColor}"
							style="transform: {getSegmentLabelTransform(i)};"
						>
							{segment.label}
						</span>
					</div>
				{/each}
			</div>
		</div>

		{#if resultMessage && !spinning}
			<Alert variant={resultType === 'success' ? 'default' : resultType === 'error' ? 'destructive' : 'default'} class="w-full max-w-md">
				<AlertTitle>{resultType === 'success' ? 'Woohoo!' : resultType === 'error' ? 'Oops!' : 'Spin Result'}</AlertTitle>
				<AlertDescription>{resultMessage}</AlertDescription>
			</Alert>
		{/if}

		<div class="w-full max-w-md space-y-4">
			<div>
				<label for="wheel-bet-amount" class="mb-1 block text-xs font-medium text-muted-foreground">Bet Amount</label>
				<div class="relative">
					<CircleDollarSign class="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
					<Input
						id="wheel-bet-amount"
						type="text" <!-- Changed to text to allow comma formatting -->
						value={betAmountDisplay}
						oninput={handleBetAmountInput}
						onblur={handleBetAmountBlur}
						placeholder="Bet Amount"
						class="pl-10"
						disabled={spinning}
					/>
				</div>
				<p class="text-muted-foreground mt-1 text-xs">
					Max bet: {MAX_BET_AMOUNT.toLocaleString()}
				</p>
			</div>

			<div>
				<div class="grid grid-cols-4 gap-2">
					<Button size="sm" variant="outline" onclick={() => setBetPercentage(0.25)} disabled={spinning}>25%</Button>
					<Button size="sm" variant="outline" onclick={() => setBetPercentage(0.50)} disabled={spinning}>50%</Button>
					<Button size="sm" variant="outline" onclick={() => setBetPercentage(0.75)} disabled={spinning}>75%</Button>
					<Button size="sm" variant="outline" onclick={() => setBetPercentage(1.00)} disabled={spinning}>Max</Button>
				</div>
			</div>

			<Button onclick={spinWheel} disabled={spinning || betAmount <=0 || betAmount > balance} class="h-12 w-full text-lg">
				{#if spinning}
					<Loader2 class="mr-2 h-4 w-4 animate-spin" />
					Spinning...
				{:else}
					<RotateCw class="mr-2 h-4 w-4" />
					Spin the Wheel
				{/if}
			</Button>
		</div>
		<!-- Removed redundant balance display from here, it's at the top of CardContent -->
	</CardContent>
</Card>
<style>
	/* Ensure the pointer is above the wheel segments */
	.absolute.z-10 {
		z-index: 10;
	}
</style>
