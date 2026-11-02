using ChiefOfStaff.Core.Models;
using Microsoft.EntityFrameworkCore;

namespace ChiefOfStaff.Data.Services;

public class PersonService(IDbContextFactory<AppDbContext> dbFactory)
{
    public async Task<List<PersonSummary>> GetSummariesAsync()
    {
        await using var db = await dbFactory.CreateDbContextAsync();
        var people = await db.People.OrderByDescending(p => p.PriorityWeight).ThenBy(p => p.Name).ToListAsync();
        var counts = await db.WorkItems
            .Where(w => w.RequesterId != null &&
                        (w.Status == WorkItemStatus.Open || w.Status == WorkItemStatus.InProgress || w.Status == WorkItemStatus.WaitingOn))
            .GroupBy(w => w.RequesterId!.Value)
            .Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Key, x => x.Count);
        return people.Select(p => new PersonSummary(p, counts.GetValueOrDefault(p.Id))).ToList();
    }

    public async Task<List<Person>> GetAllAsync()
    {
        await using var db = await dbFactory.CreateDbContextAsync();
        return await db.People.OrderBy(p => p.Name).ToListAsync();
    }

    public async Task<Person> SaveAsync(Person person)
    {
        await using var db = await dbFactory.CreateDbContextAsync();
        var entity = person.Id == 0 ? null : await db.People.FindAsync(person.Id);
        if (entity is null)
        {
            entity = new Person();
            db.People.Add(entity);
        }
        entity.Name = person.Name.Trim();
        entity.Role = person.Role;
        entity.Email = person.Email;
        entity.PriorityWeight = Math.Clamp(person.PriorityWeight, 1, 5);
        await db.SaveChangesAsync();
        person.Id = entity.Id;
        return entity;
    }

    /// <summary>Deletes the person; tasks they requested keep existing with no requester.</summary>
    public async Task DeleteAsync(int id)
    {
        await using var db = await dbFactory.CreateDbContextAsync();
        await db.WorkItems.Where(w => w.RequesterId == id).ExecuteUpdateAsync(s => s.SetProperty(w => w.RequesterId, (int?)null));
        await db.People.Where(p => p.Id == id).ExecuteDeleteAsync();
        await db.ContextBriefs.Where(c => c.Scope == BriefScope.Person && c.OwnerId == id).ExecuteDeleteAsync();
    }
}

public record PersonSummary(Person Person, int OpenCount);
