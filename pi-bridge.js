// pi-bridge.js - Processes Pi sensor readings into patient records

// Auto-run every 10 seconds
setInterval(processSensorReadings, 10000);

async function processSensorReadings() {
    // Get unprocessed readings from last 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60000).toISOString();
    
    const { data: readings, error } = await supabaseClient
        .from('sensor_readings')
        .select('*')
        .eq('processed', false)
        .gte('created_at', fiveMinutesAgo)
        .order('created_at', { ascending: true });
    
    if (error || !readings || readings.length === 0) return;
    
    for (const reading of readings) {
        await createOrUpdatePatient(reading);
    }
}

async function createOrUpdatePatient(reading) {
    const today = new Date().toISOString().split('T')[0];
    const hashtag = `#${String(reading.patient_no).padStart(3, '0')}`;
    const time = new Date(reading.created_at).toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', hour12: true
    });
    
    // Build vitals object
    const vitals = {
        temperature: reading.temperature ? `${reading.temperature}°C` : '-',
        heartRate: reading.heart_rate ? `${reading.heart_rate} bpm` : '-',
        bloodPressure: '-',
        oxygenSat: reading.spo2 ? `${reading.spo2}%` : '-'
    };
    
    // Use existing stability checker
    const stability = determineStability(vitals);
    
    // Check if patient exists
    const { data: existing } = await supabaseClient
        .from('patients')
        .select('id')
        .eq('hashtag', hashtag)
        .eq('date', today)
        .single();
    
    if (existing) {
        // Update existing
        await supabaseClient
            .from('patients')
            .update({
                vitals: vitals,
                status: stability.status,
                stability_reason: stability.reason,
                updated_at: new Date().toISOString()
            })
            .eq('id', existing.id);
    } else {
        // Create new (empty name = pending registration)
        await supabaseClient
            .from('patients')
            .insert([{
                hashtag: hashtag,
                date: today,
                time: time,
                name: '',  // Empty = shows as pending in your dashboard
                school_id: '',
                age: null,
                gender: '',
                grade: '',
                contact: '',
                vitals: vitals,
                status: stability.status,
                stability_reason: stability.reason,
                complaint: '',
                notes: `Auto-generated from Pi | Temp: ${reading.temp_status}`
            }]);
    }
    
    // Mark reading as processed
    await supabaseClient
        .from('sensor_readings')
        .update({ processed: true })
        .eq('id', reading.id);
    
    // Refresh dashboard if visible
    if (typeof loadPatientsFromDB === 'function') {
        await loadPatientsFromDB();
        if (typeof renderAll === 'function') renderAll();
    }
}