<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { toast } from 'svelte-sonner';
	import { CircleDollarSign, Loader2, LogOut, Play } from 'lucide-svelte';
	import { onMount, onDestroy } from 'svelte';
	import { websocketController, WebsocketEvent } from '$lib/stores/websocket';
	import { tweened } from 'svelte/motion';
	import { cubicOut } from 'svelte/easing';
	import { formatValue, playSound, showConfetti } from '$lib/utils';
	import { volumeSettings } from '$lib/stores/volume-settings';
	import confetti from 'canvas-confetti';

	let { balance = $bindable(), onBalanceUpdate } = $props<{
		balance: number;
		onBalanceUpdate: (newBalance: number) => void;
	}>();

	type GamePhase = 'betting' | 'running' | 'crashed' | 'connecting';
	const MAX_BET_AMOUNT = 1000000;

	let betAmount = $state(10);
	let betAmountDisplay = $state(betAmount.toLocaleString());
	let gamePhase = $state<GamePhase>('connecting');
	let currentMultiplier = $state(1.0);
	const displayedMultiplier = tweened(1.0, { duration: 100, easing: cubicOut });

	let isLoading = $state(false);
	let placedBetThisRound = $state(false);
	let cashedOutThisRound = $state(false);
	let lastBetAmount = $state(0);

	let statusMessage = $state('');
	let resultMessage = $state('');
	let resultType: 'success' | 'error' | 'info' = $state('info');

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

	const handleWebSocketMessage = (event: MessageEvent) => {
		try {
			const data = JSON.parse(event.data);

			if (data.type === 'crash_game_state') {
				gamePhase = data.phase;
				currentMultiplier = data.multiplier || 1.0;
				displayedMultiplier.set(currentMultiplier, { duration: data.phase === 'running' ? 100 : 0 });

				if (data.phase === 'betting') {
					statusMessage = `Next round starting soon. Place your bets!`;
					if(data.multiplier) statusMessage += ` Last multiplier: ${data.multiplier.toFixed(2)}x`;
					placedBetThisRound = false;
					cashedOutThisRound = false;
					resultMessage = '';
				} else if (data.phase === 'running') {
					statusMessage = `Running... Multiplier: ${currentMultiplier.toFixed(2)}x`;
				} else if (data.phase === 'crashed') {
					statusMessage = `CRASHED @ ${data.crashPoint.toFixed(2)}x! Next round soon...`;
					if (placedBetThisRound && !cashedOutThisRound) {
						resultMessage = `Oh no! The game crashed before you cashed out. You lost ${formatValue(lastBetAmount)}.`;
						resultType = 'error';
						toast.error(`Crashed! You lost your bet of ${formatValue(lastBetAmount)}.`);
						playSound('lose');
					}
					placedBetThisRound = false;
					cashedOutThisRound = false;
				}
			} else if (data.type === 'crash_multiplier_update' && gamePhase === 'running') {
				currentMultiplier = data.multiplier;
				displayedMultiplier.set(currentMultiplier);
				statusMessage = `Running... Multiplier: ${currentMultiplier.toFixed(2)}x`;
			} else if (data.type === 'crash_game_crashed') {
				gamePhase = 'crashed';
				currentMultiplier = data.crashPoint;
				displayedMultiplier.set(currentMultiplier, {duration: 0});
				statusMessage = `CRASHED @ ${data.crashPoint.toFixed(2)}x! Next round soon...`;
				if (placedBetThisRound && !cashedOutThisRound) {
					resultMessage = `Oh no! The game crashed at ${data.crashPoint.toFixed(2)}x. You lost ${formatValue(lastBetAmount)}.`;
					resultType = 'error';
					toast.error(`Crashed at ${data.crashPoint.toFixed(2)}x! You lost your bet of ${formatValue(lastBetAmount)}.`);
					playSound('lose');
				}
				placedBetThisRound = false;
				cashedOutThisRound = false;
			}
		} catch (error) {
			console.error('Error processing WebSocket message:', error);
		}
	};

	onMount(() => {
		volumeSettings.load();
		fetchInitialStatus();

		websocketController.subscribe(WebsocketEvent.Message, handleWebSocketMessage);
		if (websocketController.isConnected()) {
			websocketController.send(JSON.stringify({ type: 'join_crash_game' }));
			gamePhase = 'betting';
		} else {
			gamePhase = 'connecting';
			statusMessage = 'Connecting to game server...';
		}

		const handleConnect = () => {
			statusMessage = 'Connected! Waiting for next round.';
			websocketController.send(JSON.stringify({ type: 'join_crash_game' }));
			fetchInitialStatus();
		};
		const handleDisconnect = () => {
			gamePhase = 'connecting';
			statusMessage = 'Disconnected. Attempting to reconnect...';
		};

		websocketController.subscribe(WebsocketEvent.Open, handleConnect);
		websocketController.subscribe(WebsocketEvent.Close, handleDisconnect);

		return () => {
			websocketController.unsubscribe(WebsocketEvent.Message, handleWebSocketMessage);
			websocketController.unsubscribe(WebsocketEvent.Open, handleConnect);
			websocketController.unsubscribe(WebsocketEvent.Close, handleDisconnect);
		};
	});

	async function fetchInitialStatus() {
		isLoading = true;
		try {
			const response = await fetch('/api/gambling/crash/status');
			if (!response.ok) throw new Error('Failed to fetch initial status');
			const data = await response.json();
			gamePhase = data.status || 'betting';
			currentMultiplier = data.currentMultiplier || 1.0;
			displayedMultiplier.set(currentMultiplier, { duration: 0 });
			if(gamePhase === 'betting') statusMessage = `Next round starting soon. Place your bets!`;
			else if(gamePhase === 'running') statusMessage = `Running... Multiplier: ${currentMultiplier.toFixed(2)}x`;
			else if(gamePhase === 'crashed' && data.lastCrashPoint) statusMessage = `CRASHED @ ${data.lastCrashPoint?.toFixed(2)}x! Next round soon...`;
			else if(gamePhase === 'crashed') statusMessage = `Crashed! Next round soon...`;


		} catch (error) {
			console.warn('Could not fetch initial crash game status:', error);
		} finally {
			isLoading = false;
		}
	}

	async function placeBet() {
		if (isLoading || gamePhase === 'running' || placedBetThisRound) return;
		if (betAmount <= 0) {
			toast.error('Bet amount must be greater than 0.');
			return;
		}
		if (betAmount > balance) {
			toast.error('Insufficient balance.');
			return;
		}

		isLoading = true;
		resultMessage = '';
		try {
			const response = await fetch('/api/gambling/crash/bet', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ betAmount })
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error || `Server error: ${response.status}`);
			}

			// const betResult = await response.json(); // Assuming backend returns newBalance or specific bet confirmation
			// For now, rely on onBalanceUpdate from cashout or next full balance update.
			// Optimistic UI update for balance can be tricky with real-time games.
			// Let's assume the API deducts the balance and the next full sync will catch it,
			// or cashout will return the absolute new balance.
			// To be safe, we can call onBalanceUpdate with the known deduction.
			onBalanceUpdate(balance - betAmount);


			lastBetAmount = betAmount;
			placedBetThisRound = true;
			cashedOutThisRound = false;
			resultMessage = `Bet of ${formatValue(betAmount)} placed! Waiting for round to start...`;
			resultType = 'info';
			toast.success(`Bet of ${formatValue(betAmount)} placed successfully!`);
			playSound('click');

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Failed to place bet.';
			resultMessage = errorMessage;
			resultType = 'error';
			toast.error(errorMessage);
			playSound('lose');
		} finally {
			isLoading = false;
		}
	}

	async function cashOut() {
		if (isLoading || gamePhase !== 'running' || !placedBetThisRound || cashedOutThisRound) return;

		isLoading = true;
		try {
			const response = await fetch('/api/gambling/crash/cashout', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error || `Server error: ${response.status}`);
			}

			const cashoutResult: {
				success: boolean;
				message: string;
				cashOutMultiplier: number;
				payoutAmount: number;
				newBalance: number;
			} = await response.json();

			onBalanceUpdate(cashoutResult.newBalance);

			cashedOutThisRound = true;
			resultMessage = `Cashed out at ${cashoutResult.cashOutMultiplier.toFixed(2)}x! You won ${formatValue(cashoutResult.payoutAmount)}.`;
			resultType = 'success';
			toast.success(resultMessage);
			playSound('win');
			if (cashoutResult.cashOutMultiplier >= 2) { // Confetti for good cashouts
				showConfetti(confetti);
			}

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Failed to cash out.';
			resultMessage = errorMessage;
			resultType = 'error';
			toast.error(errorMessage);
			playSound('lose');
		} finally {
			isLoading = false;
		}
	}

	const canPlaceBet = $derived(
		!isLoading && (gamePhase === 'betting' || gamePhase === 'crashed') && !placedBetThisRound && betAmount > 0 && betAmount <= balance
	);
	const canCashOut = $derived(
		!isLoading && gamePhase === 'running' && placedBetThisRound && !cashedOutThisRound
	);

	const multiplierColor = $derived(() => {
		if (gamePhase === 'crashed') return 'text-destructive';
		if ($displayedMultiplier < 1.5) return 'text-blue-500';
		if ($displayedMultiplier < 3) return 'text-green-500';
		if ($displayedMultiplier < 5) return 'text-yellow-500';
		return 'text-orange-500';
	});

</script>

<Card>
	<CardHeader>
		<CardTitle>Crash Game</CardTitle>
		<CardDescription>Place your bet and cash out before the multiplier crashes!</CardDescription>
	</CardHeader>
	<CardContent class="flex flex-col items-center gap-6">
		<!-- Balance Display -->
		<div class="text-center">
			<p class="text-muted-foreground text-sm">Balance</p>
			<p class="text-2xl font-bold">{formatValue(balance)}</p>
		</div>

		<!-- Multiplier Display -->
		<div class="my-4 flex h-48 w-full items-center justify-center rounded-lg bg-muted/50 p-4 text-center shadow-inner md:h-64">
			<div class="flex flex-col items-center">
				<p class:animate-pulse={gamePhase === 'running'} class="text-6xl font-bold {multiplierColor} md:text-8xl transition-colors duration-300">
					{$displayedMultiplier.toFixed(2)}x
				</p>
				<p class="mt-2 text-sm text-muted-foreground min-h-[1.25rem]">{statusMessage || ' '}</p>
			</div>
		</div>

		{#if resultMessage && (gamePhase === 'crashed' || cashedOutThisRound)}
			<Alert variant={resultType === 'success' ? 'default' : resultType === 'error' ? 'destructive' : 'default'} class="w-full max-w-md">
				<AlertTitle>{resultType === 'success' ? 'Success!' : resultType === 'error' ? 'Game Over!' : 'Info'}</AlertTitle>
				<AlertDescription>{resultMessage}</AlertDescription>
			</Alert>
		{/if}

		<div class="w-full max-w-md space-y-4">
			<div>
				<label for="crash-bet-amount" class="mb-1 block text-xs font-medium text-muted-foreground">Bet Amount</label>
				<div class="relative">
					<CircleDollarSign class="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
					<Input
						id="crash-bet-amount"
						type="text"
						value={betAmountDisplay}
						oninput={handleBetAmountInput}
						onblur={handleBetAmountBlur}
						placeholder="Bet Amount"
						class="pl-10"
						disabled={isLoading || placedBetThisRound || gamePhase === 'running'}
					/>
				</div>
				<p class="text-muted-foreground mt-1 text-xs">
					Max bet: {MAX_BET_AMOUNT.toLocaleString()}
				</p>
			</div>

			<div>
				<div class="grid grid-cols-4 gap-2">
					<Button size="sm" variant="outline" onclick={() => setBetPercentage(0.25)} disabled={isLoading || placedBetThisRound || gamePhase === 'running'}>25%</Button>
					<Button size="sm" variant="outline" onclick={() => setBetPercentage(0.50)} disabled={isLoading || placedBetThisRound || gamePhase === 'running'}>50%</Button>
					<Button size="sm" variant="outline" onclick={() => setBetPercentage(0.75)} disabled={isLoading || placedBetThisRound || gamePhase === 'running'}>75%</Button>
					<Button size="sm" variant="outline" onclick={() => setBetPercentage(1.00)} disabled={isLoading || placedBetThisRound || gamePhase === 'running'}>Max</Button>
				</div>
			</div>

			{#if !placedBetThisRound || gamePhase === 'betting' || gamePhase === 'crashed'}
				<Button onclick={placeBet} disabled={!canPlaceBet} class="h-12 w-full text-lg {canPlaceBet ? '' : 'opacity-70 cursor-not-allowed'}">
					{#if isLoading && !placedBetThisRound} <Loader2 class="mr-2 h-4 w-4 animate-spin" /> Placing Bet... {:else} <Play class="mr-2 h-4 w-4" /> Place Bet {/if}
				</Button>
			{:else}
				<Button onclick={cashOut} disabled={!canCashOut} class="h-12 w-full text-lg bg-green-600 hover:bg-green-700 {canCashOut ? '' : 'opacity-70 cursor-not-allowed'}">
					{#if isLoading && placedBetThisRound} <Loader2 class="mr-2 h-4 w-4 animate-spin" /> Cashing Out... {:else} <LogOut class="mr-2 h-4 w-4" /> Cash Out at {$displayedMultiplier.toFixed(2)}x {/if}
				</Button>
			{/if}
		</div>

		{#if placedBetThisRound && !cashedOutThisRound && gamePhase !== 'crashed'}
			<p class="text-sm text-blue-500">Bet of {formatValue(lastBetAmount)} is active!</p>
		{/if}
	</CardContent>
</Card>
