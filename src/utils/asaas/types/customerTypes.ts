export interface ASAASCreateCustomerDTO {
	name: string;
	cpfCnpj: string;
	email?: string;
	phone?: string;
	mobilePhone?: string;
	address?: string;
	addressNumber?: string;
	complement?: string;
	province?: string;
	postalCode?: string;
	externalReference?: string;
	notificationDisabled?: boolean;
	additionalEmails?: string;
	municipalInscription?: string;
	stateInscription?: string;
	observations?: string;
	groupName?: string;
}

export interface ASAASCustomerResponse {
	id: string;
	dateCreated: string;
	name: string;
	email: string | null;
	phone: string | null;
	mobilePhone: string | null;
	address: string | null;
	addressNumber: string | null;
	complement: string | null;
	province: string | null;
	postalCode: string | null;
	cpfCnpj: string;
	personType: "FISICA" | "JURIDICA";
	deleted: boolean;
	additionalEmails: string | null;
	externalReference: string | null;
	notificationDisabled: boolean;
	city: string | null;
	state: string | null;
	country: string | null;
	observations: string | null;
	municipalInscription: string | null;
	stateInscription: string | null;
	canDelete: boolean;
	cannotBeDeletedReason: string | null;
	canEdit: boolean;
	cannotEditReason: string | null;
	foreignCustomer: boolean;
	groupName: string | null;
}

export interface ASAASUpdateCustomerDTO {
	name?: string;
	email?: string;
	phone?: string;
	mobilePhone?: string;
	address?: string;
	addressNumber?: string;
	complement?: string;
	province?: string;
	postalCode?: string;
	cpfCnpj?: string;
	personType?: "FISICA" | "JURIDICA";
	notificationDisabled?: boolean;
	additionalEmails?: string;
	externalReference?: string;
	municipalInscription?: string;
	stateInscription?: string;
	observations?: string;
	groupName?: string;
}

export interface ASAASListCustomersFilters {
	name?: string;
	email?: string;
	cpfCnpj?: string;
	groupName?: string;
	externalReference?: string;
	offset?: number;
	limit?: number;
}

export interface ASAASListCustomersResponse {
	object: "list";
	hasMore: boolean;
	totalCount: number;
	limit: number;
	offset: number;
	data: ASAASCustomerResponse[];
}

export interface ASAASCustomerErrorResponse {
	errors: Array<{
		code: string;
		description: string;
	}>;
}

export interface ASAASRestoreCustomerResponse {
	id: string;
	deleted: boolean;
	dateCreated: string;
}
