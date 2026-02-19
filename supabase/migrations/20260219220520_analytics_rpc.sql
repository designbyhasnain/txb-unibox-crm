-- ==============================================================================
-- Analytics Dashboard RPC logic
-- High performance aggregation checking `email_logs` and `replies`
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.get_analytics_dashboard(
    p_campaign_id UUID DEFAULT NULL
) 
RETURNS jsonb 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_result jsonb;
BEGIN
    -- Securely resolve user
    v_user_id := auth.uid();

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    WITH stats AS (
        SELECT 
            COUNT(id) FILTER (WHERE sent_at IS NOT NULL) AS total_sent,
            COUNT(id) FILTER (WHERE opened_at IS NOT NULL) AS total_opens
        FROM public.email_logs
        WHERE user_id = v_user_id
          AND (p_campaign_id IS NULL OR campaign_id = p_campaign_id)
    ),
    reply_stats AS (
        SELECT 
            COUNT(id) AS total_replies
        FROM public.replies
        WHERE user_id = v_user_id
          AND (p_campaign_id IS NULL OR campaign_id = p_campaign_id)
    )
    SELECT 
        jsonb_build_object(
            'total_sent', COALESCE(s.total_sent, 0),
            'total_opens', COALESCE(s.total_opens, 0),
            'total_replies', COALESCE(r.total_replies, 0),
            'open_rate', CASE 
                WHEN COALESCE(s.total_sent, 0) > 0 THEN ROUND((COALESCE(s.total_opens, 0)::numeric / s.total_sent::numeric) * 100, 2)
                ELSE 0.00
            END,
            'reply_rate', CASE 
                WHEN COALESCE(s.total_sent, 0) > 0 THEN ROUND((COALESCE(r.total_replies, 0)::numeric / s.total_sent::numeric) * 100, 2)
                ELSE 0.00
            END
        ) INTO v_result
    FROM stats s, reply_stats r;

    RETURN v_result;
END;
$$;

-- Grant API access to authenticated users
GRANT EXECUTE ON FUNCTION public.get_analytics_dashboard TO authenticated;
