export class DeliveryError extends Error
{
    constructor(code, message, items = [])
    {
        super(message);
        this.code = code;
        this.items = items;
    }
}

export function deliveryFailure(error)
{
    return error instanceof DeliveryError ? {code:error.code,items:error.items} : null;
}
