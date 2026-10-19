export function hasPublicationProof(proof,lease,recoverPublication,now=new Date())
{
    if (proof?.state!=='completed' || !lease) return false;
    const expiry=new Date(lease.expires_at).getTime();
    if (expiry>now.getTime()) return true;
    // Recovery does not extend execution authorization; only the publication deadline changes.
    return Boolean(recoverPublication && proof.finished_at && new Date(proof.finished_at).getTime()<=expiry);
}
