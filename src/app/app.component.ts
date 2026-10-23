import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SelectButtonModule } from 'primeng/selectbutton';
import { FilterService } from './core/filter.service';
import { FilesPanelComponent } from './features/files-panel/files-panel.component';
import { FiltersPanelComponent } from './features/filters-panel/filters-panel.component';
import { GroupByViewComponent } from './features/group-by-view/group-by-view.component';
import { RowsViewComponent } from './features/rows-view/rows-view.component';

type View = 'rows' | 'groups';

@Component({
  selector: 'app-root',
  imports: [FormsModule, SelectButtonModule, FilesPanelComponent, FiltersPanelComponent, GroupByViewComponent, RowsViewComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  protected filters = inject(FilterService);
  protected view = signal<View>('rows');
  protected viewOptions = [
    { label: 'Rows', value: 'rows' },
    { label: 'Group by', value: 'groups' },
  ];
}
