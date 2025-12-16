
import { CashbackService } from "./CashbackService";
import {PrismaCashbackWalletRepository} from "../../repositories/implementations/PrismaCashbackWalletRepository";
import {
    PrismaCashbackTransactionRepository
} from "../../repositories/implementations/PrismaCashbackTransactionRepository";
import {CashbackController} from "./CashbackController";


const walletRepository = new PrismaCashbackWalletRepository();
const transactionRepository = new PrismaCashbackTransactionRepository();

const cashbackService = new CashbackService(
    walletRepository,
    transactionRepository,
);

export const cashbackController = new CashbackController(cashbackService);
