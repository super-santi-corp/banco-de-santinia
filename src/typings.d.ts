export type TransactionStatus = 'approved' | 'pending' | 'declined';

export interface Transaction {
	readonly datetime: number;
	readonly amount: number;
	status: TransactionStatus;
	readonly id: string;
	readonly payer: string;
	readonly payee: string;
	readonly purpose: string;
	readonly error: unknown;
}
